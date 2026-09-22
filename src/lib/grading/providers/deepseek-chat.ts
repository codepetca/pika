import type { GradingTokenUsage } from '@/lib/grading/contracts'
import {
  GradingProviderError,
  type StructuredOutputProvider,
  type StructuredOutputRequest,
  type StructuredOutputResponse,
} from '@/lib/grading/providers/types'

const DEEPSEEK_CHAT_COMPLETIONS_URL = 'https://api.deepseek.com/chat/completions'
const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504])

// DeepSeek exposes coarse thinking tiers instead of OpenAI's reasoning_effort
// scale. Map the provider-neutral levels onto the tiers the API accepts.
const DEEPSEEK_REASONING_EFFORT: Record<StructuredOutputRequest['reasoningEffort'], string> = {
  minimal: 'low',
  low: 'low',
  medium: 'high',
  high: 'max',
}

// Reasoning is what consumes the output budget, so when even the fallback budget truncates,
// raising the ceiling is the wrong lever — the model will simply think up to the new one, and
// the ceiling is capped by the model regardless. Thinking less is the lever that works. A
// grade produced with shallower reasoning beats no grade at all.
const DEEPSEEK_EFFORT_DOWNGRADE: Partial<
  Record<StructuredOutputRequest['reasoningEffort'], StructuredOutputRequest['reasoningEffort']>
> = {
  high: 'medium',
  medium: 'low',
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: unknown }).name
  return name === 'AbortError' || name === 'TimeoutError'
}

// DeepSeek JSON output only guarantees syntactic validity, so the schema has to
// travel in the prompt. The engine still validates every field before use.
function buildSchemaDirectedSystemPrompt(request: StructuredOutputRequest): string {
  return `${request.systemPrompt}

Reply with a single json object named "${request.schemaName}" that validates against this JSON Schema. Output only that json object: no prose, no explanation, no markdown code fences.
${JSON.stringify(request.jsonSchema)}`
}

export function createDeepSeekChatProvider(opts: {
  apiKey: string
  fetchImpl?: typeof fetch
}): StructuredOutputProvider {
  const fetchImpl = opts.fetchImpl ?? fetch

  return {
    id: 'deepseek',
    async generate(request): Promise<StructuredOutputResponse> {
      let requestCount = 1
      let payload = await fetchPayload(fetchImpl, opts.apiKey, request, request.initialMaxOutputTokens)
      let tokenUsage = readTokenUsage(payload)

      if (isMaxOutputIncomplete(payload)) {
        requestCount += 1
        payload = await fetchPayload(fetchImpl, opts.apiKey, request, request.fallbackMaxOutputTokens)
        tokenUsage = addTokenUsage(tokenUsage, readTokenUsage(payload))
      }

      let reasoningEffortUsed = request.reasoningEffort
      const reducedEffort = DEEPSEEK_EFFORT_DOWNGRADE[request.reasoningEffort]
      if (isMaxOutputIncomplete(payload) && reducedEffort) {
        requestCount += 1
        payload = await fetchPayload(
          fetchImpl,
          opts.apiKey,
          request,
          request.fallbackMaxOutputTokens,
          reducedEffort,
        )
        tokenUsage = addTokenUsage(tokenUsage, readTokenUsage(payload))
        reasoningEffortUsed = reducedEffort
      }

      if (isMaxOutputIncomplete(payload)) {
        throw new GradingProviderError({
          kind: 'bad_response',
          message: 'DeepSeek response incomplete: max_tokens',
          retryable: false,
        })
      }

      const outputText = extractOutputText(payload)
      if (!outputText) {
        throw new GradingProviderError({
          kind: 'bad_response',
          message: 'DeepSeek response missing structured output',
          retryable: false,
        })
      }

      return { outputText, tokenUsage, requestCount, reasoningEffortUsed }
    },
  }
}

async function fetchPayload(
  fetchImpl: typeof fetch,
  apiKey: string,
  request: StructuredOutputRequest,
  maxOutputTokens: number,
  reasoningEffortOverride?: StructuredOutputRequest['reasoningEffort'],
): Promise<unknown> {
  let response: Response
  try {
    response = await fetchImpl(DEEPSEEK_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        stream: false,
        messages: [
          { role: 'system', content: buildSchemaDirectedSystemPrompt(request) },
          { role: 'user', content: request.userPrompt },
        ],
        reasoning_effort: DEEPSEEK_REASONING_EFFORT[reasoningEffortOverride ?? request.reasoningEffort],
        max_tokens: maxOutputTokens,
        response_format: { type: 'json_object' },
      }),
      signal: request.requestTimeoutMs && request.requestTimeoutMs > 0
        ? AbortSignal.timeout(request.requestTimeoutMs)
        : undefined,
    })
  } catch (error) {
    const timedOut = isTimeoutError(error)
    throw new GradingProviderError({
      kind: timedOut ? 'timeout' : 'network',
      message: timedOut
        ? 'DeepSeek grading request timed out'
        : 'DeepSeek request failed',
      retryable: true,
    })
  }

  if (!response.ok) {
    // Provider bodies may echo prompts or credentials. Never retain them in diagnostics.
    await response.body?.cancel().catch(() => {})
    const retryable = RETRYABLE_STATUS_CODES.has(response.status)
    throw new GradingProviderError({
      kind: response.status === 429
        ? 'rate_limit'
        : retryable
          ? 'server'
          : response.status === 401 || response.status === 402 || response.status === 403
            ? 'config'
            : 'bad_response',
      message: `DeepSeek request failed (${response.status})`,
      retryable,
      statusCode: response.status,
    })
  }

  try {
    return await response.json()
  } catch (error) {
    const timedOut = isTimeoutError(error)
    throw new GradingProviderError({
      kind: timedOut ? 'timeout' : 'bad_response',
      message: timedOut
        ? 'DeepSeek grading response timed out'
        : `DeepSeek returned invalid JSON (status ${response.status})`,
      retryable: timedOut,
      statusCode: response.status,
    })
  }
}

function firstChoice(payload: unknown): {
  message?: { content?: unknown }
  finish_reason?: unknown
} | null {
  const choices = (payload as { choices?: unknown })?.choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const choice = choices[0]
  return choice && typeof choice === 'object' ? choice : null
}

function extractOutputText(payload: unknown): string | null {
  // Thinking mode returns reasoning_content alongside content; only content
  // carries the structured answer.
  const content = firstChoice(payload)?.message?.content
  if (typeof content !== 'string') return null
  const trimmed = content.trim()
  return trimmed ? trimmed : null
}

function isMaxOutputIncomplete(payload: unknown): boolean {
  return firstChoice(payload)?.finish_reason === 'length'
}

function readTokenUsage(payload: unknown): GradingTokenUsage {
  const usage = (payload as { usage?: Record<string, unknown> })?.usage ?? {}
  return {
    inputTokens: finiteInteger(usage.prompt_tokens),
    outputTokens: finiteInteger(usage.completion_tokens),
    totalTokens: finiteInteger(usage.total_tokens),
  }
}

function addTokenUsage(left: GradingTokenUsage, right: GradingTokenUsage): GradingTokenUsage {
  return {
    inputTokens: addNullable(left.inputTokens, right.inputTokens),
    outputTokens: addNullable(left.outputTokens, right.outputTokens),
    totalTokens: addNullable(left.totalTokens, right.totalTokens),
  }
}

function finiteInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function addNullable(left: number | null, right: number | null): number | null {
  if (left === null || right === null) return null
  return left + right
}

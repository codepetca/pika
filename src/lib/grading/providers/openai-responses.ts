import type { GradingTokenUsage } from '@/lib/grading/contracts'
import {
  GradingProviderError,
  type StructuredOutputProvider,
  type StructuredOutputRequest,
  type StructuredOutputResponse,
} from '@/lib/grading/providers/types'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504])

export function createOpenAiResponsesProvider(opts: {
  apiKey: string
  fetchImpl?: typeof fetch
}): StructuredOutputProvider {
  const fetchImpl = opts.fetchImpl ?? fetch

  return {
    id: 'openai',
    async generate(request): Promise<StructuredOutputResponse> {
      let requestCount = 1
      let payload = await fetchPayload(fetchImpl, opts.apiKey, request, request.initialMaxOutputTokens)
      let tokenUsage = readTokenUsage(payload)

      if (isMaxOutputIncomplete(payload)) {
        requestCount += 1
        payload = await fetchPayload(fetchImpl, opts.apiKey, request, request.fallbackMaxOutputTokens)
        tokenUsage = addTokenUsage(tokenUsage, readTokenUsage(payload))
      }

      if (isMaxOutputIncomplete(payload)) {
        throw new GradingProviderError({
          kind: 'bad_response',
          message: 'OpenAI response incomplete: max_output_tokens',
          retryable: false,
        })
      }

      const outputText = extractOutputText(payload)
      if (!outputText) {
        throw new GradingProviderError({
          kind: 'bad_response',
          message: 'OpenAI response missing structured output',
          retryable: false,
        })
      }

      return { outputText, tokenUsage, requestCount }
    },
  }
}

async function fetchPayload(
  fetchImpl: typeof fetch,
  apiKey: string,
  request: StructuredOutputRequest,
  maxOutputTokens: number,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        store: false,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: request.systemPrompt }] },
          { role: 'user', content: [{ type: 'input_text', text: request.userPrompt }] },
        ],
        reasoning: { effort: request.reasoningEffort },
        max_output_tokens: maxOutputTokens,
        text: {
          format: {
            type: 'json_schema',
            name: request.schemaName,
            strict: true,
            schema: request.jsonSchema,
          },
        },
      }),
      signal: request.requestTimeoutMs > 0
        ? AbortSignal.timeout(request.requestTimeoutMs)
        : undefined,
    })
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
    throw new GradingProviderError({
      kind: timedOut ? 'timeout' : 'network',
      message: timedOut
        ? 'OpenAI grading request timed out'
        : error instanceof Error ? error.message : 'OpenAI request failed',
      retryable: true,
    })
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    const retryable = RETRYABLE_STATUS_CODES.has(response.status)
    throw new GradingProviderError({
      kind: response.status === 429
        ? 'rate_limit'
        : retryable
          ? 'server'
          : response.status === 401 || response.status === 403
            ? 'config'
            : 'bad_response',
      message: `OpenAI request failed (${response.status}): ${bodyText}`,
      retryable,
      statusCode: response.status,
    })
  }

  return response.json()
}

function extractOutputText(payload: unknown): string | null {
  const record = payload as { output_text?: unknown; output_parsed?: unknown; output?: unknown }
  if (typeof record?.output_text === 'string' && record.output_text.trim()) {
    return record.output_text.trim()
  }
  if (record?.output_parsed && typeof record.output_parsed === 'object') {
    return JSON.stringify(record.output_parsed)
  }
  if (!Array.isArray(record?.output)) return null

  const textParts: string[] = []
  for (const item of record.output) {
    const content = (item as { content?: unknown })?.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      const output = part as { type?: unknown; text?: unknown; parsed?: unknown; json?: unknown }
      if (output.type === 'output_text' && typeof output.text === 'string' && output.text.trim()) {
        textParts.push(output.text.trim())
      } else if (output.parsed && typeof output.parsed === 'object') {
        return JSON.stringify(output.parsed)
      } else if (output.json && typeof output.json === 'object') {
        return JSON.stringify(output.json)
      }
    }
  }
  return textParts.length > 0 ? textParts.join('\n') : null
}

function isMaxOutputIncomplete(payload: unknown): boolean {
  const record = payload as { status?: unknown; incomplete_details?: { reason?: unknown } }
  return record?.status === 'incomplete' && record.incomplete_details?.reason === 'max_output_tokens'
}

function readTokenUsage(payload: unknown): GradingTokenUsage {
  const usage = (payload as { usage?: Record<string, unknown> })?.usage ?? {}
  return {
    inputTokens: finiteInteger(usage.input_tokens),
    outputTokens: finiteInteger(usage.output_tokens),
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
  if (left === null) return right
  if (right === null) return left
  return left + right
}

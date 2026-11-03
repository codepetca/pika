import { inspect } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { createOpenAiResponsesProvider, OpenAiSpendLimitError } from '@/lib/grading/providers/openai-responses'
import type { StructuredOutputRequest } from '@/lib/grading/providers/types'

const request: StructuredOutputRequest = {
  model: 'synthetic', systemPrompt: 'Grade', userPrompt: 'Synthetic work', schemaName: 'grade',
  jsonSchema: { type: 'object' }, initialMaxOutputTokens: 100, fallbackMaxOutputTokens: 200,
  reasoningEffort: 'medium',
}
const marker = 'PRIVATE synthetic@example.invalid student-work'

function provider(fetchImpl: typeof fetch) {
  return createOpenAiResponsesProvider({ apiKey: 'synthetic-key', fetchImpl })
}

describe('OpenAI Responses grading provider', () => {
  it('sends strict structured output without storage and reports usage and effort', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: '{"ok":true}', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    })))
    const result = await provider(fetchImpl).generate(request)
    expect(result).toEqual({ outputText: '{"ok":true}', requestCount: 1, reasoningEffortUsed: 'medium',
      tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(init.redirect).toBe('error')
    expect(JSON.parse(init.body)).toMatchObject({ store: false, reasoning: { effort: 'medium' },
      text: { format: { type: 'json_schema', strict: true, schema: request.jsonSchema } } })
  })

  it('retries a truncated response once with the fallback budget and sums usage', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 10, output_tokens: 100, total_tokens: 110 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: '{}',
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } })))
    const result = await provider(fetchImpl).generate(request)
    expect(result).toMatchObject({ requestCount: 2, tokenUsage: { inputTokens: 20, outputTokens: 120, totalTokens: 140 } })
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).max_output_tokens).toBe(200)
  })

  it.each(['organization_spend_limit_exceeded', 'project_spend_limit_exceeded'] as const)(
    'recognizes exact %s without retaining the response body', async (code) => {
      const error = await provider(vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code, message: marker } }),
        { status: 429 }))).generate(request).catch((failure: unknown) => failure)
      expect(error).toBeInstanceOf(OpenAiSpendLimitError)
      expect(error).toMatchObject({ spendLimitCode: code, kind: 'config', retryable: false, statusCode: 429 })
      expect(inspect(error, { depth: null })).not.toContain(marker)
      expect(error).not.toHaveProperty('cause')
    },
  )

  it.each([
    JSON.stringify({ error: { code: 'insufficient_quota', message: marker } }),
    JSON.stringify({ error: { code: 'project_spend_limit_exceeded_extra', message: marker } }),
    JSON.stringify({ code: 'project_spend_limit_exceeded', message: marker }),
    marker,
    JSON.stringify({ error: { code: 'project_spend_limit_exceeded', message: marker.repeat(2000) } }),
  ])('does not classify arbitrary, malformed, or oversized error bodies as spend limits', async (body) => {
    const error = await provider(vi.fn().mockResolvedValue(new Response(body, { status: 429 })))
      .generate(request).catch((failure: unknown) => failure)
    expect(error).not.toBeInstanceOf(OpenAiSpendLimitError)
    expect(error).toMatchObject({ kind: 'rate_limit', retryable: true, statusCode: 429 })
    expect(inspect(error, { depth: null })).not.toContain(marker)
  })

  it('does not expose transport failures', async () => {
    const error = await provider(vi.fn().mockRejectedValue(new Error(marker)))
      .generate(request).catch((failure: unknown) => failure)
    expect(error).toMatchObject({ kind: 'network', retryable: true })
    expect(inspect(error, { depth: null })).not.toContain(marker)
    expect(error).not.toHaveProperty('cause')
  })
})

describe('shared operation deadline', () => {
  it('caps each attempt by time remaining and stops before a retry after expiry', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(250)
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } })))
    try {
      await expect(provider(fetchImpl).generate({ ...request, requestTimeoutMs: 60_000, deadlineMs: 200 }))
        .rejects.toMatchObject({ kind: 'timeout', retryable: true })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(timeout).toHaveBeenCalledWith(100)
    } finally { clock.mockRestore(); timeout.mockRestore() }
  })
})

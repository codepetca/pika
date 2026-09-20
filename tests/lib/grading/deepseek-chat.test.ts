import { inspect } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { createDeepSeekChatProvider } from '@/lib/grading/providers/deepseek-chat'
import type { StructuredOutputRequest } from '@/lib/grading/providers/types'

const privateMarker = 'PRIVATE synthetic@example.invalid code-123456 student-work'
const request: StructuredOutputRequest = {
  model: 'synthetic-model', systemPrompt: 'Grade', userPrompt: 'Synthetic response',
  schemaName: 'synthetic', jsonSchema: { type: 'object' },
  initialMaxOutputTokens: 100, fallbackMaxOutputTokens: 200, reasoningEffort: 'minimal',
}

async function failureFrom(fetchImpl: typeof fetch) {
  const provider = createDeepSeekChatProvider({ apiKey: 'synthetic-key', fetchImpl })
  const error = await provider.generate(request).catch((error: unknown) => error)
  expect(error).toBeInstanceOf(Error)
  expect(inspect(error, { depth: null })).not.toContain(privateMarker)
  expect(error).not.toHaveProperty('cause')
  return error
}

describe('DeepSeek content-free failure diagnostics', () => {
  it.each([
    [400, 'bad_response', false], [401, 'config', false], [402, 'config', false], [403, 'config', false],
    [408, 'server', true], [409, 'server', true], [429, 'rate_limit', true],
    [500, 'server', true], [502, 'server', true], [503, 'server', true], [504, 'server', true],
  ])('retains status/category/retry behavior without reading the %i error body', async (status, kind, retryable) => {
    const response = new Response(privateMarker, { status })
    const text = vi.spyOn(response, 'text')
    const cancel = vi.spyOn(response.body!, 'cancel')
    const error = await failureFrom(vi.fn().mockResolvedValue(response))
    expect(error).toMatchObject({ statusCode: status, kind, retryable, message: `DeepSeek request failed (${status})` })
    expect(text).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('does not preserve malformed JSON, response headers or parser causes', async () => {
    const error = await failureFrom(vi.fn().mockResolvedValue(new Response(privateMarker, {
      status: 200, headers: { 'content-type': privateMarker },
    })))
    expect(error).toMatchObject({ kind: 'bad_response', retryable: false, statusCode: 200,
      message: 'DeepSeek returned invalid JSON (status 200)' })
  })

  it.each(['Error', 'AbortError', 'TimeoutError'])('bounds %s transport failures', async (name) => {
    const error = await failureFrom(vi.fn().mockRejectedValue(Object.assign(new Error(privateMarker), { name })))
    expect(error).toMatchObject({ kind: name === 'Error' ? 'network' : 'timeout', retryable: true,
      message: name === 'Error' ? 'DeepSeek request failed' : 'DeepSeek grading request timed out' })
  })

  it('retains response-body timeout classification without its message', async () => {
    const response = new Response('{}')
    vi.spyOn(response, 'json').mockRejectedValue(Object.assign(new Error(privateMarker), { name: 'TimeoutError' }))
    expect(await failureFrom(vi.fn().mockResolvedValue(response))).toMatchObject({
      kind: 'timeout', retryable: true, statusCode: 200, message: 'DeepSeek grading response timed out',
    })
  })
})

function jsonResponse(payload: unknown) {
  return { ok: true, json: async () => payload }
}

describe('DeepSeek structured-output request shape', () => {
  it('asks for json output and carries the schema in the system prompt', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    }))

    const result = await createDeepSeekChatProvider({ apiKey: 'synthetic-key', fetchImpl }).generate({
      ...request,
      jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      reasoningEffort: 'medium',
    })

    expect(result).toEqual({
      outputText: '{"ok":true}',
      tokenUsage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
      requestCount: 1,
    })

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(init.redirect).toBe('error')
    const body = JSON.parse(String(init.body))
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.reasoning_effort).toBe('high')
    expect(body.max_tokens).toBe(request.initialMaxOutputTokens)
    expect(body.messages[1].content).toBe(request.userPrompt)
    // DeepSeek json mode needs the literal word "json" plus the target shape.
    expect(body.messages[0].content).toContain('json object')
    expect(body.messages[0].content).toContain('"properties":{"ok":{"type":"boolean"}}')
  })

  it.each([
    ['minimal', 'low'],
    ['low', 'low'],
    ['medium', 'high'],
    ['high', 'max'],
  ] as const)('maps %s reasoning effort to the %s DeepSeek tier', async (effort, tier) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
    }))
    await createDeepSeekChatProvider({ apiKey: 'synthetic-key', fetchImpl })
      .generate({ ...request, reasoningEffort: effort })
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1].body)).reasoning_effort).toBe(tier)
  })

  it('retries once with the fallback token budget when the first reply is truncated', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: '{"partial"' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 10, completion_tokens: 100, total_tokens: 110 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }))

    const result = await createDeepSeekChatProvider({ apiKey: 'synthetic-key', fetchImpl }).generate(request)

    expect(result.requestCount).toBe(2)
    expect(result.outputText).toBe('{"ok":true}')
    expect(result.tokenUsage).toEqual({ inputTokens: 20, outputTokens: 120, totalTokens: 140 })
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1].body)).max_tokens)
      .toBe(request.fallbackMaxOutputTokens)
  })

  it('fails without retrying further when the fallback reply is still truncated', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '{"partial"' }, finish_reason: 'length' }],
    }))
    await expect(
      createDeepSeekChatProvider({ apiKey: 'synthetic-key', fetchImpl }).generate(request),
    ).rejects.toMatchObject({
      kind: 'bad_response',
      retryable: false,
      message: 'DeepSeek response incomplete: max_tokens',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['no choices', { choices: [] }],
    ['a non-string content', { choices: [{ message: { content: null }, finish_reason: 'stop' }] }],
    ['empty content', { choices: [{ message: { content: '   ' }, finish_reason: 'stop' }] }],
  ])('rejects a 200 reply with %s', async (_label, payload) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(payload))
    await expect(
      createDeepSeekChatProvider({ apiKey: 'synthetic-key', fetchImpl }).generate(request),
    ).rejects.toMatchObject({
      kind: 'bad_response',
      retryable: false,
      message: 'DeepSeek response missing structured output',
    })
  })

  it('reports unknown token usage when the reply omits it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
    }))
    const result = await createDeepSeekChatProvider({ apiKey: 'synthetic-key', fetchImpl }).generate(request)
    expect(result.tokenUsage).toEqual({ inputTokens: null, outputTokens: null, totalTokens: null })
  })
})

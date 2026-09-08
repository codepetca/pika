import { inspect } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { createOpenAiResponsesProvider } from '@/lib/grading/providers/openai-responses'
import type { StructuredOutputRequest } from '@/lib/grading/providers/types'

const privateMarker = 'PRIVATE synthetic@example.invalid code-123456 student-work'
const request: StructuredOutputRequest = {
  model: 'synthetic-model', systemPrompt: 'Grade', userPrompt: 'Synthetic response',
  schemaName: 'synthetic', jsonSchema: { type: 'object' },
  initialMaxOutputTokens: 100, fallbackMaxOutputTokens: 200, reasoningEffort: 'minimal',
}

async function failureFrom(fetchImpl: typeof fetch) {
  const provider = createOpenAiResponsesProvider({ apiKey: 'synthetic-key', fetchImpl })
  const error = await provider.generate(request).catch((error: unknown) => error)
  expect(error).toBeInstanceOf(Error)
  expect(inspect(error, { depth: null })).not.toContain(privateMarker)
  expect(error).not.toHaveProperty('cause')
  return error
}

describe('OpenAI content-free failure diagnostics', () => {
  it.each([
    [400, 'bad_response', false], [401, 'config', false], [403, 'config', false],
    [408, 'server', true], [409, 'server', true], [429, 'rate_limit', true],
    [500, 'server', true], [502, 'server', true], [503, 'server', true], [504, 'server', true],
  ])('retains status/category/retry behavior without reading the %i error body', async (status, kind, retryable) => {
    const response = new Response(privateMarker, { status })
    const text = vi.spyOn(response, 'text')
    const cancel = vi.spyOn(response.body!, 'cancel')
    const error = await failureFrom(vi.fn().mockResolvedValue(response))
    expect(error).toMatchObject({ statusCode: status, kind, retryable, message: `OpenAI request failed (${status})` })
    expect(text).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('does not preserve malformed JSON, response headers or parser causes', async () => {
    const error = await failureFrom(vi.fn().mockResolvedValue(new Response(privateMarker, {
      status: 200, headers: { 'content-type': privateMarker },
    })))
    expect(error).toMatchObject({ kind: 'bad_response', retryable: false, statusCode: 200,
      message: 'OpenAI returned invalid JSON (status 200)' })
  })

  it.each(['Error', 'AbortError', 'TimeoutError'])('bounds %s transport failures', async (name) => {
    const error = await failureFrom(vi.fn().mockRejectedValue(Object.assign(new Error(privateMarker), { name })))
    expect(error).toMatchObject({ kind: name === 'Error' ? 'network' : 'timeout', retryable: true,
      message: name === 'Error' ? 'OpenAI request failed' : 'OpenAI grading request timed out' })
  })

  it('retains response-body timeout classification without its message', async () => {
    const response = new Response('{}')
    vi.spyOn(response, 'json').mockRejectedValue(Object.assign(new Error(privateMarker), { name: 'TimeoutError' }))
    expect(await failureFrom(vi.fn().mockResolvedValue(response))).toMatchObject({
      kind: 'timeout', retryable: true, statusCode: 200, message: 'OpenAI grading response timed out',
    })
  })
})

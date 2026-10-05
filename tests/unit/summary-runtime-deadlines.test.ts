import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callOpenAIForSummary } from '@/lib/log-summary'
import { callOpenAIForDeveloperFeedback, extractAndStoreDeveloperFeedbackCandidates } from '@/lib/developer-log-feedback'
import { AIRequestDeadlineError, withAIRequestDeadline } from '@/lib/ai-request-deadline'

describe('summary and feedback deadlines', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it.each([
    ['summary', 20_000, () => callOpenAIForSummary('system', 'user', {})],
    ['feedback', 5_000, () => callOpenAIForDeveloperFeedback('system', 'user')],
  ] as const)('bounds a hanging %s fetch by default', async (_kind, timeout, call) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}))
    const pending = call()
    const rejection = expect(pending).rejects.toBeInstanceOf(AIRequestDeadlineError)
    await vi.advanceTimersByTimeAsync(timeout)
    await rejection
    expect((fetchMock.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the response body inside the summary deadline', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: () => new Promise(() => {}),
    } as unknown as Response)
    const pending = callOpenAIForSummary('system', 'user', {}, { timeoutMs: 100 })
    const rejection = expect(pending).rejects.toBeInstanceOf(AIRequestDeadlineError)
    await vi.advanceTimersByTimeAsync(100)
    await rejection
    expect((fetchMock.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true)
  })

  it('fences late feedback output from storing candidates after cancellation', async () => {
    let resolveBody!: (body: unknown) => void
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: () => new Promise((resolve) => { resolveBody = resolve }),
    } as unknown as Response)
    const rpc = vi.fn()
    const pending = extractAndStoreDeveloperFeedbackCandidates({ rpc }, {
      classroomId: 'classroom-1', date: '2026-10-02', sourceEntryCount: 1,
      model: 'test', sanitizedLogs: [{ initials: 'A.B.', text: 'Improve the navigation' }],
    })
    const rejection = expect(pending).rejects.toBeInstanceOf(AIRequestDeadlineError)
    await vi.advanceTimersByTimeAsync(5_000)
    await rejection
    resolveBody({ output_text: JSON.stringify({ candidates: [{
      title: 'Navigation', original_request: 'Confusing navigation', refined_request: 'Improve navigation', confidence: 0.9,
    }] }) })
    await vi.advanceTimersByTimeAsync(0)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('propagates job cancellation promptly and never starts pre-cancelled operations', async () => {
    const parent = new AbortController()
    let signal: AbortSignal | undefined
    const operation = vi.fn(async (requestSignal: AbortSignal) => {
      signal = requestSignal
      return new Promise<never>(() => {})
    })
    const pending = withAIRequestDeadline(operation, { signal: parent.signal })
    const rejection = expect(pending).rejects.toThrow('job stopped')
    await vi.advanceTimersByTimeAsync(0)
    parent.abort(new Error('job stopped'))
    await rejection
    expect(signal?.aborted).toBe(true)
    operation.mockClear()
    await expect(withAIRequestDeadline(operation, { signal: parent.signal })).rejects.toThrow('job stopped')
    expect(operation).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

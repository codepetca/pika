import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startAiGradingRunPolling } from '../../src/lib/ai-grading-run-poll'

const run = {
  id: 'run-1', assignment_id: 'assignment-1', status: 'running', model: null,
  requested_count: 2, gradable_count: 2, processed_count: 0, completed_count: 0,
  skipped_missing_count: 0, skipped_empty_count: 0, failed_count: 0, pending_count: 2,
  next_retry_at: null, error_samples: [], started_at: null, completed_at: null,
  created_at: '2026-10-08T12:00:00Z',
}
const response = (data: unknown, status = 200) => ({
  ok: status >= 200 && status < 300, status, json: async () => data,
}) as Response
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

describe('teacher AI grading run polling', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let onRun: ReturnType<typeof vi.fn>
  let onUnavailable: ReturnType<typeof vi.fn>
  let cancel: (() => void) | undefined
  const start = () => {
    cancel = startAiGradingRunPolling({
      resource: 'assignment', resourceId: 'assignment-1', runId: 'run-1',
      statusUrl: '/run', onRun, onUnavailable,
    })
  }
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    onRun = vi.fn()
    onUnavailable = vi.fn()
  })
  afterEach(() => { cancel?.(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it.each([401, 403, 404])('stops after status HTTP %i without advancing the run', async (status) => {
    fetchMock.mockResolvedValue(response({ error: 'unavailable' }, status))
    start(); await settle(); await vi.advanceTimersByTimeAsync(180_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onRun).not.toHaveBeenCalled()
    expect(onUnavailable).toHaveBeenCalledTimes(1)
  })

  it.each([{}, { run: null }, { run: { ...run, status: 'unknown' } },
    { run: { ...run, assignment_id: 'other' } }, { run: { ...run, id: 'other' } }])(
    'stops on missing, invalid, or wrong-owner run state: %j', async (data) => {
      fetchMock.mockResolvedValue(response(data))
      start(); await settle(); await vi.advanceTimersByTimeAsync(180_000)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(onRun).not.toHaveBeenCalled()
      expect(onUnavailable).toHaveBeenCalledTimes(1)
    },
  )

  it('does not tick after invalid JSON', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError() } })
    start(); await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onUnavailable).toHaveBeenCalledTimes(1)
  })

  it('retries a failed status read with exponential backoff and then stops', async () => {
    fetchMock.mockRejectedValue(new TypeError('network failed'))
    start(); await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(3999)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(180_000)
    expect(fetchMock).toHaveBeenCalledTimes(6)
    expect(fetchMock.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true)
    expect(onUnavailable).toHaveBeenCalledTimes(1)
  })

  it('adds bounded jitter to transport retries', async () => {
    vi.mocked(Math.random).mockReturnValue(1)
    fetchMock.mockRejectedValue(new TypeError('offline'))
    start(); await settle(); await vi.advanceTimersByTimeAsync(2099)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not make another read after the failure deadline elapses', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'))
    start(); await settle()
    vi.setSystemTime(Date.now() + 120_000)
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onUnavailable).toHaveBeenCalledTimes(1)
  })

  it('times out and aborts a stalled status request without ticking', async () => {
    fetchMock.mockImplementation((_, init: RequestInit) => new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    start(); await settle(); await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true)
  })

  it('allows explicit reactivation to reconnect to the same saved run', async () => {
    fetchMock.mockResolvedValueOnce(response({}, 401))
    start(); await settle(); cancel?.()
    fetchMock.mockResolvedValueOnce(response({ run: { ...run, status: 'completed' } }))
    start(); await settle()
    expect(onRun).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'run-1', status: 'completed' }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each(['completed', 'completed_with_errors', 'failed'])('stops at terminal %s status', async (status) => {
    fetchMock.mockResolvedValue(response({ run: { ...run, status } }))
    start(); await settle(); await vi.advanceTimersByTimeAsync(180_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onRun).toHaveBeenCalledTimes(1)
    expect(onUnavailable).not.toHaveBeenCalled()
  })

  it('checks status before each tick and preserves the successful two-second cadence', async () => {
    fetchMock.mockResolvedValue(response({ run }))
    start(); await settle()
    expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'POST'])
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'POST', 'GET', 'POST'])
  })

  it('honors the retry deadline without status reads every ten seconds', async () => {
    const retryAt = new Date(Date.now() + 60_000).toISOString()
    fetchMock.mockImplementation(() => Promise.resolve(response({ run: {
      ...run, next_retry_at: Date.now() < Date.parse(retryAt) ? retryAt : null,
    } })))
    start(); await settle(); await vi.advanceTimersByTimeAsync(59_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(251)
    expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'GET', 'POST'])
  })

  it('bounds long retry waits and never advances before the advertised deadline', async () => {
    fetchMock.mockResolvedValue(response({ run: { ...run, next_retry_at: '2099-01-01T00:00:00Z' } }))
    start(); await settle(); await vi.advanceTimersByTimeAsync(120_500)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true)
  })

  it('aborts a pending read and ignores its late completion after owner cancellation', async () => {
    let resolve!: (value: Response) => void
    fetchMock.mockReturnValue(new Promise<Response>((done) => { resolve = done }))
    start(); await settle()
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    cancel?.()
    expect(signal.aborted).toBe(true)
    resolve(response({ run })); await settle(); await vi.advanceTimersByTimeAsync(180_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onRun).not.toHaveBeenCalled()
    expect(onUnavailable).not.toHaveBeenCalled()
  })

  it('ignores a late tick completion after owner cancellation', async () => {
    let resolve!: (value: Response) => void
    fetchMock.mockResolvedValueOnce(response({ run }))
      .mockReturnValueOnce(new Promise<Response>((done) => { resolve = done }))
    start(); await settle(); cancel?.()
    resolve(response({ run: { ...run, status: 'completed' } })); await settle()
    expect(onRun).toHaveBeenCalledTimes(1)
    expect(onUnavailable).not.toHaveBeenCalled()
  })

  it('recovers from a transient tick failure by reconciling status before another tick', async () => {
    fetchMock.mockResolvedValueOnce(response({ run }))
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response({ run: { ...run, status: 'completed' } }))
    start(); await settle(); await vi.advanceTimersByTimeAsync(2000)
    expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'POST', 'GET'])
    expect(onRun).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'completed' }))
    expect(onUnavailable).not.toHaveBeenCalled()
  })
})

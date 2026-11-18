import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestGradingBatchController } from '@/hooks/useTestGradingBatchController'

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
const callbacks = () => ({ onStart: vi.fn(), onRun: vi.fn(), onNoop: vi.fn(), onError: vi.fn() })
const response = (status: number, data: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => data } as Response)

describe('test grading batch owner', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  it('passes a 202 run to the existing run owner and preserves selection intent', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(202, { run: { id: 'run-A', test_id: 'A' } }))
    const actions = callbacks()
    const { result } = renderHook(() => useTestGradingBatchController({ classroomId: 'C', testId: 'A', ...actions }))
    await act(async () => { await result.current.start('all', ['s1'], { preserveSelection: true }) })
    expect(fetcher).toHaveBeenCalledWith('/api/teacher/tests/A/auto-grade', expect.objectContaining({ method: 'POST', body: JSON.stringify({ student_ids: ['s1'], grade_scope: 'all' }) }))
    expect(actions.onRun).toHaveBeenCalledWith({ id: 'run-A', test_id: 'A' }, true, true)
    expect(actions.onError).not.toHaveBeenCalled()
  })
  it('resumes a 409 run while reporting its error and permits a retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(409, { run: { id: 'existing', test_id: 'A' }, error: 'Already active' }))
      .mockResolvedValueOnce(response(200, { summary: { message: 'Nothing to grade' } }))
    const actions = callbacks()
    const { result } = renderHook(() => useTestGradingBatchController({ classroomId: 'C', testId: 'A', ...actions }))
    await act(async () => { await result.current.start('all', ['s1']) })
    expect(actions.onRun).toHaveBeenCalledWith({ id: 'existing', test_id: 'A' }, false, false)
    expect(actions.onError).toHaveBeenCalledWith('Already active')
    await act(async () => { await result.current.start('ungraded', ['s1']) })
    expect(actions.onNoop).toHaveBeenCalledWith({ message: 'Nothing to grade' }, false, expect.any(Function))
    expect(result.current.running).toBe(false)
  })
  it('reports an active permission error and permits retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(403, { error: 'Permission changed' }))
      .mockResolvedValueOnce(response(202, { run: { id: 'run-A', test_id: 'A' } }))
    const actions = callbacks()
    const { result } = renderHook(() => useTestGradingBatchController({ classroomId: 'C', testId: 'A', ...actions }))
    await act(async () => { await result.current.start('all', ['s1']) })
    expect(actions.onError).toHaveBeenCalledWith('Permission changed')
    expect(result.current.running).toBe(false)
    await act(async () => { await result.current.start('all', ['s1']) })
    expect(actions.onRun).toHaveBeenCalledWith({ id: 'run-A', test_id: 'A' }, true, false)
  })

  it('aborts and retires A when test or classroom changes; late A cannot publish a run or error', async () => {
    const pending = deferred<Response>()
    const fetcher = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(pending.promise)
    const actions = callbacks()
    const { result, rerender } = renderHook(({ classroomId, testId }) => useTestGradingBatchController({ classroomId, testId, ...actions }),
      { initialProps: { classroomId: 'C', testId: 'A' } })
    act(() => { void result.current.start('all', ['s1']) })
    const signal = (fetcher.mock.calls[0][1] as RequestInit).signal!
    rerender({ classroomId: 'D', testId: 'B' })
    expect(signal.aborted).toBe(true)
    expect(result.current.running).toBe(false)
    await act(async () => { pending.resolve(response(202, { run: { id: 'old', test_id: 'A' } })); await pending.promise })
    expect(actions.onRun).not.toHaveBeenCalled()
    expect(actions.onNoop).not.toHaveBeenCalled()
    expect(actions.onError).not.toHaveBeenCalled()
  })
  it('invalidates an in-progress refresh after switching owners', async () => {
    const pendingRefresh = deferred<void>()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(200, { summary: {} }))
    const actions = callbacks()
    const publishRefresh = vi.fn()
    actions.onNoop.mockImplementation(async (_summary, _preserve, isCurrent) => {
      await pendingRefresh.promise
      if (isCurrent()) publishRefresh()
    })
    const { result, rerender } = renderHook(({ testId }) => useTestGradingBatchController({ classroomId: 'C', testId, ...actions }),
      { initialProps: { testId: 'A' } })
    act(() => { void result.current.start('all', ['s1']) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(actions.onNoop).toHaveBeenCalledOnce()
    rerender({ testId: 'B' })
    await act(async () => { pendingRefresh.resolve(); await pendingRefresh.promise })
    expect(publishRefresh).not.toHaveBeenCalled()
  })

  it('cancels on unmount without showing a permission or transport error', async () => {
    const pending = deferred<Response>()
    const fetcher = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(pending.promise)
    const actions = callbacks()
    const { result, unmount } = renderHook(() => useTestGradingBatchController({ classroomId: 'C', testId: 'A', ...actions }))
    act(() => { void result.current.start('all', ['s1']) })
    unmount()
    expect((fetcher.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true)
    await act(async () => { pending.resolve(response(403, { error: 'Denied' })); await pending.promise })
    expect(actions.onError).not.toHaveBeenCalled()
  })
})

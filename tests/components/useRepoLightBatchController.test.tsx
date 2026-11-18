import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRepoLightBatchController } from '@/hooks/useRepoLightBatchController'
import { executeRepoLightBatch, type RepoLightBatchResult } from '@/lib/repolight-batch'

vi.mock('@/lib/repolight-batch', () => ({ executeRepoLightBatch: vi.fn() }))
const execute = vi.mocked(executeRepoLightBatch)
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
const student = { studentId: 'student-1', expectedDocUpdatedAt: 'revision', name: 'Student One' }
const result: RepoLightBatchResult = { studentId: 'student-1', status: 'imported', reason: 'Added' }

describe('repository batch owner', () => {
  beforeEach(() => execute.mockReset())

  it('retires A immediately on a classroom or assignment switch and ignores late progress and completion', async () => {
    const pending = deferred<RepoLightBatchResult[]>()
    execute.mockReturnValueOnce(pending.promise)
    const onComplete = vi.fn(), onError = vi.fn()
    const { result: hook, rerender } = renderHook(({ classroomId, assignmentId }) =>
      useRepoLightBatchController({ classroomId, assignmentId, onComplete, onError }),
    { initialProps: { classroomId: 'class-A', assignmentId: 'assignment-A' as string | null } })
    act(() => { void hook.current.start([student]) })
    const request = execute.mock.calls[0][0]
    expect(hook.current.running).toBe(true)
    rerender({ classroomId: 'class-B', assignmentId: 'assignment-B' })
    expect(request.signal.aborted).toBe(true)
    expect(hook.current.open).toBe(false)
    expect(hook.current.running).toBe(false)
    act(() => request.onProgress?.({ studentId: student.studentId, index: 0, total: 1, phase: 'finished', result }))
    await act(async () => { pending.resolve([result]); await pending.promise })
    expect(hook.current.results).toEqual([])
    expect(onComplete).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('does not let late A completion replace an active B run, including after returning to A', async () => {
    const first = deferred<RepoLightBatchResult[]>()
    const second = deferred<RepoLightBatchResult[]>()
    execute.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const onComplete = vi.fn()
    const { result: hook, rerender } = renderHook(({ assignmentId }) =>
      useRepoLightBatchController({ classroomId: 'class-A', assignmentId, onComplete, onError: vi.fn() }),
    { initialProps: { assignmentId: 'A' } })
    act(() => { void hook.current.start([student]) })
    rerender({ assignmentId: 'B' })
    act(() => { void hook.current.start([{ ...student, name: 'B student' }]) })
    await act(async () => { first.resolve([result]); await first.promise })
    expect(hook.current.running).toBe(true)
    expect(hook.current.names['student-1']).toBe('B student')
    expect(hook.current.results).toEqual([])
    expect(onComplete).not.toHaveBeenCalled()
    await act(async () => { second.resolve([result]); await second.promise })
    expect(hook.current.results).toEqual([result])
    rerender({ assignmentId: 'A' })
    expect(hook.current.open).toBe(false)
    expect(hook.current.results).toEqual([])
  })

  it('stops the active run and permits retry after it settles', async () => {
    const pending = deferred<RepoLightBatchResult[]>()
    execute.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([result])
    const onComplete = vi.fn()
    const { result: hook } = renderHook(() => useRepoLightBatchController({ classroomId: 'class-A', assignmentId: 'assignment-A', onComplete, onError: vi.fn() }))
    act(() => { void hook.current.start([student]) })
    act(() => hook.current.stop())
    expect(execute.mock.calls[0][0].signal.aborted).toBe(true)
    await act(async () => { pending.resolve([]); await pending.promise })
    expect(hook.current.running).toBe(false)
    await act(async () => { await hook.current.start([student]) })
    expect(execute).toHaveBeenCalledTimes(2)
    expect(hook.current.results).toEqual([result])
    expect(onComplete).toHaveBeenCalledTimes(2)
  })
})

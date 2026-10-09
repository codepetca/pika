import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAssignmentScheduling } from '@/hooks/useAssignmentScheduling'
import type { Assignment } from '@/types'

function record(id: string): Assignment {
  return { id, classroom_id: 'session-class', title: id, description: '', instructions_markdown: '',
    due_at: '2099-10-20T23:59:59Z', position: 0, is_draft: true, released_at: null,
    created_by: 'session-teacher' } as Assignment
}
const A = record('scheduling-session-A')
const B = record('scheduling-session-B')
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
type Options = Parameters<typeof useAssignmentScheduling>[0]

describe('useAssignmentScheduling ownership after public resetForAssignment', () => {
  let jsonA: ReturnType<typeof deferred<Record<string, unknown>>>
  let jsonB: ReturnType<typeof deferred<Record<string, unknown>>>
  let fetchMock: ReturnType<typeof vi.fn>
  let pending: Promise<void>[]
  beforeEach(() => {
    jsonA = deferred(); jsonB = deferred(); pending = []
    fetchMock = vi.fn(async (url: string) => {
      if (url === `/api/teacher/assignments/${A.id}/release` || url === `/api/teacher/assignments/${A.id}`) return { ok: true, json: () => jsonA.promise }
      if (url === `/api/teacher/assignments/${B.id}/release`) return { ok: true, json: () => jsonB.promise }
      throw new Error(`Unexpected mocked URL ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(async () => {
    await act(async () => {
      jsonA.resolve({ assignment: A }); jsonB.resolve({ assignment: B })
      await Promise.all(pending)
    })
    cleanup()
    vi.unstubAllGlobals()
  })

  function mount(flush: Options['flushPendingChanges'] = async () => {}, initial: Assignment = A) {
    let ownerOpen = true
    const onAssignmentChange = vi.fn()
    const onError = vi.fn()
    const onClose = vi.fn(() => { ownerOpen = false })
    // The parent default close is part of the production callback contract.
    const onSuccess = vi.fn((_assignment: Assignment, options?: { closeModal?: boolean }) => {
      if (options?.closeModal !== false) ownerOpen = false
    })
    const options: Options = { currentAssignment: initial, isCreateMode: false, creating: false, saving: false,
      flushPendingChanges: flush, onAssignmentChange, onError, onClose, onSuccess }
    const hook = renderHook((props: Options) => useAssignmentScheduling(props), { initialProps: options })
    function replace(next: Assignment | null = B) {
      ownerOpen = next !== null
      hook.rerender({ ...options, currentAssignment: next })
      act(() => hook.result.current.resetForAssignment(next))
      onAssignmentChange.mockClear(); onError.mockClear(); onClose.mockClear(); onSuccess.mockClear()
    }
    return { ...hook, replace, onAssignmentChange, onError, onClose, onSuccess, isOpen: () => ownerOpen }
  }
  async function begin(operation: () => Promise<void>) {
    await act(async () => { pending.push(operation()) })
  }
  async function finishA(data: Record<string, unknown>) {
    await act(async () => { jsonA.resolve(data); await pending[0] })
  }

  it('does not reopen an old schedule dialog after owner close and reset while flush is pending', async () => {
    const flush = deferred<void>()
    const hook = mount(() => flush.promise)
    await begin(() => hook.result.current.openScheduleModalWithSave())
    hook.replace(null)
    await act(async () => { flush.resolve(); await pending[0] })
    expect(hook.result.current.showCreateScheduleModal).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(hook.isOpen()).toBe(false)
  })

  it('preserves the initiated A post after delayed flush without changing or closing replacement B', async () => {
    const flush = deferred<void>()
    const hook = mount(() => flush.promise)
    await begin(() => hook.result.current.postAssignmentNow())
    expect(fetchMock).not.toHaveBeenCalled()
    hook.replace()
    // Owner reset does not cancel an initiated backend command. Its resource
    // remains A, while its eventual completion must leave B's editor alone.
    const posted = { ...A, is_draft: false, released_at: '2026-10-07T15:00:00Z' }
    jsonA.resolve({ assignment: posted })
    await act(async () => { flush.resolve(); await pending[0] })
    expect.soft(fetchMock).toHaveBeenCalledTimes(1)
    expect.soft(fetchMock).toHaveBeenCalledWith(`/api/teacher/assignments/${A.id}/release`, { method: 'POST' })
    expect.soft(hook.onSuccess).toHaveBeenCalledWith(posted, { closeModal: false })
    expect.soft(hook.onAssignmentChange).not.toHaveBeenCalled()
    expect.soft(hook.onError).not.toHaveBeenCalled()
    expect.soft(hook.onClose).not.toHaveBeenCalled()
    expect(hook.isOpen()).toBe(true)
  })

  it('publishes an already submitted A post without changing or closing B', async () => {
    const hook = mount()
    await begin(() => hook.result.current.postAssignmentNow())
    expect(fetchMock).toHaveBeenCalledWith(`/api/teacher/assignments/${A.id}/release`, { method: 'POST' })
    hook.replace()
    const posted = { ...A, is_draft: false, released_at: '2026-10-07T15:00:00Z' }
    await finishA({ assignment: posted })
    expect.soft(hook.onSuccess).toHaveBeenCalledWith(posted, { closeModal: false })
    expect.soft(hook.onAssignmentChange).not.toHaveBeenCalled()
    expect.soft(hook.onClose).not.toHaveBeenCalled()
    expect(hook.isOpen()).toBe(true)
  })

  it('ignores A post failure after reset while preserving B confirmation', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === `/api/teacher/assignments/${A.id}/release`) return { ok: false, json: () => jsonA.promise }
      throw new Error(`Unexpected mocked URL ${url}`)
    })
    const hook = mount()
    await begin(() => hook.result.current.postAssignmentNow())
    hook.replace()
    act(() => hook.result.current.setShowPostNowConfirm(true))
    await finishA({ error: 'A stale post error' })
    expect.soft(hook.onError).not.toHaveBeenCalled()
    expect(hook.result.current.showPostNowConfirm).toBe(true)
  })

  it('does not let A finally clear B releasing or B confirmation while B request is pending', async () => {
    const hook = mount()
    await begin(() => hook.result.current.postAssignmentNow())
    hook.replace()
    act(() => hook.result.current.setShowPostNowConfirm(true))
    await begin(() => hook.result.current.postAssignmentNow())
    expect(fetchMock).toHaveBeenCalledWith(`/api/teacher/assignments/${B.id}/release`, { method: 'POST' })
    expect(hook.result.current.releasing).toBe(true)
    await finishA({ assignment: { ...A, is_draft: false } })
    expect.soft(hook.result.current.releasing).toBe(true)
    expect.soft(hook.result.current.showPostNowConfirm).toBe(true)
    expect(hook.isOpen()).toBe(true)
    await act(async () => { jsonB.resolve({ assignment: { ...B, is_draft: false } }); await pending[1] })
  })

  it('keeps B schedule modal and action when an already submitted A schedule completes', async () => {
    const hook = mount()
    act(() => { hook.result.current.setScheduleDate('2099-10-10'); hook.result.current.setScheduleTime('09:00') })
    await begin(() => hook.result.current.scheduleAssignmentRelease({ closeAfter: false }))
    expect(fetchMock).toHaveBeenCalledWith(`/api/teacher/assignments/${A.id}/release`, expect.objectContaining({ method: 'POST' }))
    hook.replace()
    act(() => { hook.result.current.setShowCreateScheduleModal(true); hook.result.current.setPrimaryAction('post') })
    const scheduled = { ...A, is_draft: false, released_at: '2099-10-10T13:00:00Z' }
    await finishA({ assignment: scheduled })
    expect.soft(hook.onSuccess).toHaveBeenCalledWith(scheduled, { closeModal: false })
    expect.soft(hook.onAssignmentChange).not.toHaveBeenCalled()
    expect.soft(hook.result.current.showCreateScheduleModal).toBe(true)
    expect.soft(hook.result.current.primaryAction).toBe('post')
    expect(hook.isOpen()).toBe(true)
  })
  it.each(['revert', 'clear'] as const)('publishes stale A %s without mutating or closing B', async (operation) => {
    const hook = mount(async () => {}, { ...A, is_draft: false, released_at: '2099-10-10T13:00:00Z' })
    await begin(() => operation === 'revert' ? hook.result.current.revertAssignmentToDraft() : hook.result.current.clearScheduledRelease())
    expect(fetchMock).toHaveBeenCalledWith(`/api/teacher/assignments/${A.id}`, expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ is_draft: true, released_at: null }) }))
    hook.replace()
    act(() => { hook.result.current.setPrimaryAction('draft'); hook.result.current.setShowRevertToDraftConfirm(true); hook.result.current.setShowCreateScheduleModal(true) })
    await finishA({ assignment: A })
    expect.soft(hook.onSuccess).toHaveBeenCalledWith(A, { closeModal: false })
    expect.soft(hook.onAssignmentChange).not.toHaveBeenCalled()
    expect.soft(hook.result.current.primaryAction).toBe('draft')
    expect.soft(hook.result.current.showRevertToDraftConfirm).toBe(true)
    expect.soft(hook.result.current.showCreateScheduleModal).toBe(true)
    expect(hook.isOpen()).toBe(true)
  })

})

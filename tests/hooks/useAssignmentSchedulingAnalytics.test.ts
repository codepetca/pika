import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAssignmentScheduling } from '@/hooks/useAssignmentScheduling'
import type { Assignment } from '@/types'

const draft = { id: 'private-assignment', is_draft: true, released_at: null } as Assignment
function mount(response: unknown, flush = async () => {}) {
  const operation = { succeed: vi.fn(), fail: vi.fn() }
  const analyticsWorkflow = { start: vi.fn(), begin: vi.fn(() => operation) }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => response })))
  const options = { currentAssignment: draft, isCreateMode: true, creating: false, saving: false,
    flushPendingChanges: flush, onAssignmentChange: vi.fn(), onSuccess: vi.fn(),
    onClose: vi.fn(), onError: vi.fn(), analyticsWorkflow }
  const hook = renderHook((props) => useAssignmentScheduling(props), { initialProps: options })
  return { ...hook, options, operation, analyticsWorkflow }
}
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Assignment release diagnostic outcomes', () => {
  it('records Post only after a matching live response', async () => {
    const hook = mount({ assignment: { ...draft, is_draft: false } })
    await act(async () => { await hook.result.current.postAssignmentNow() })
    expect(hook.analyticsWorkflow.begin).toHaveBeenCalledWith('post')
    expect(hook.operation.succeed).toHaveBeenCalledOnce()
    expect(hook.operation.fail).not.toHaveBeenCalled()
  })

  it('does not turn an acknowledged draft into a successful Post', async () => {
    const hook = mount({ assignment: draft })
    await act(async () => { await hook.result.current.postAssignmentNow() })
    expect(hook.operation.succeed).not.toHaveBeenCalled()
    expect(hook.operation.fail).toHaveBeenCalledWith('unexpected')
  })

  it('records persistence failure without exporting error text', async () => {
    const hook = mount({}, async () => { throw new Error('private authored content') })
    await act(async () => { await hook.result.current.postAssignmentNow() })
    expect(hook.operation.fail).toHaveBeenCalledWith('persistence')
    expect(hook.operation.succeed).not.toHaveBeenCalled()
  })

  it('binds delayed response to the originating workflow, not a replacement editor', async () => {
    let resolve!: () => void
    const pending = new Promise<void>((done) => { resolve = done })
    const hook = mount({ assignment: { ...draft, is_draft: false } }, () => pending)
    let request!: Promise<void>
    act(() => { request = hook.result.current.postAssignmentNow() })
    const replacement = { start: vi.fn(), begin: vi.fn(() => ({ succeed: vi.fn(), fail: vi.fn() })) }
    hook.rerender({ ...hook.options, currentAssignment: { ...draft, id: 'replacement' }, analyticsWorkflow: replacement })
    act(() => hook.result.current.resetForAssignment())
    await act(async () => { resolve(); await request })
    expect(hook.operation.succeed).toHaveBeenCalledOnce()
    expect(replacement.begin).not.toHaveBeenCalled()
  })

  it('records Schedule validation separately from persistence', async () => {
    const hook = mount({})
    act(() => { hook.result.current.setScheduleDate('2000-01-01') })
    await act(async () => { await hook.result.current.scheduleAssignmentRelease() })
    expect(hook.analyticsWorkflow.begin).toHaveBeenCalledWith('schedule')
    expect(hook.operation.fail).toHaveBeenCalledWith('validation')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('records Schedule only for the requested confirmed future release', async () => {
    const hook = mount({})
    act(() => { hook.result.current.setScheduleDate('2099-10-20'); hook.result.current.setScheduleTime('12:00') })
    const releasedAt = hook.result.current.scheduleIso
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ assignment: { ...draft, is_draft: false, released_at: releasedAt } }) } as Response)
    await act(async () => { await hook.result.current.scheduleAssignmentRelease() })
    expect(hook.operation.succeed).toHaveBeenCalledOnce()
    expect(hook.operation.fail).not.toHaveBeenCalled()
  })

  it.each([
    { ...draft, id: 'unrelated', is_draft: false },
    { id: draft.id },
  ])('does not call a mismatched or malformed response a successful Post %#', async (assignment) => {
    const hook = mount({ assignment })
    await act(async () => { await hook.result.current.postAssignmentNow() })
    expect(hook.operation.succeed).not.toHaveBeenCalled()
    expect(hook.operation.fail).toHaveBeenCalledWith('unexpected')
  })
})

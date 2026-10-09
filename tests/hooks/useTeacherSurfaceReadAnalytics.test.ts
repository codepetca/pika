import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTeacherSurfaceReadAnalytics } from '@/hooks/useTeacherSurfaceReadAnalytics'
const capture = vi.hoisted(() => vi.fn())
vi.mock('@/lib/analytics/client', () => ({ captureTeacherEvent: capture }))
beforeEach(() => { capture.mockClear(); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible') })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('visible teacher read diagnostics', () => {
  it('records one content-free terminal outcome per read', () => {
    const hook = renderHook(() => useTeacherSurfaceReadAnalytics({ surface: 'assignments', isActive: true, scope: 'private-classroom' }))
    const read = hook.result.current()
    read.ready(); read.failed(); read.ready()
    expect(capture).toHaveBeenCalledOnce()
    expect(capture).toHaveBeenCalledWith({ name: 'teacher_surface_ready', properties: { surface: 'assignments', duration_ms: expect.any(Number) } })
    expect(JSON.stringify(capture.mock.calls)).not.toContain('private-classroom')
  })
  it('drops old completion after classroom replacement or inactive retained tab', () => {
    const hook = renderHook((props) => useTeacherSurfaceReadAnalytics(props), { initialProps: { surface: 'assignments' as const, isActive: true, scope: 'A' } })
    const old = hook.result.current()
    hook.rerender({ surface: 'assignments', isActive: true, scope: 'B' })
    old.ready()
    const current = hook.result.current()
    hook.rerender({ surface: 'assignments', isActive: false, scope: 'B' })
    current.failed()
    expect(capture).not.toHaveBeenCalled()
  })
  it('drops hidden-page reads and records failures without original exceptions', () => {
    const hook = renderHook(() => useTeacherSurfaceReadAnalytics({ surface: 'assignments', isActive: true, scope: 'A' }))
    act(() => hook.result.current().failed())
    expect(capture).toHaveBeenCalledWith({ name: 'teacher_surface_failed', properties: { surface: 'assignments', failure_category: 'persistence' } })
    capture.mockClear()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    hook.result.current().ready()
    expect(capture).not.toHaveBeenCalled()
  })
})

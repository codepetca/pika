import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTeacherSurfaceAnalytics } from '@/hooks/useTeacherSurfaceAnalytics'

const capture = vi.hoisted(() => vi.fn())
vi.mock('@/lib/analytics/client', () => ({ captureTeacherEvent: capture }))
beforeEach(() => { capture.mockClear(); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible') })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('teacher surface diagnostics', () => {
  it('captures active semantic changes without private classroom IDs', () => {
    const hook = renderHook((props) => useTeacherSurfaceAnalytics(props), {
      initialProps: { role: 'teacher', surface: 'assignments', scope: 'private-classroom' },
    })
    hook.rerender({ role: 'teacher', surface: 'assignments', scope: 'private-classroom' })
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith({ name: 'teacher_surface_viewed', properties: { surface: 'assignments' } })
    hook.rerender({ role: 'teacher', surface: 'tests', scope: 'private-classroom' })
    expect(capture).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(capture.mock.calls)).not.toContain('private-classroom')
  })

  it('does not capture student context, including a teacher account in student experience', () => {
    renderHook(() => useTeacherSurfaceAnalytics({ role: 'student', surface: 'assignments', scope: 'private' }))
    expect(capture).not.toHaveBeenCalled()
  })

  it('defers views until document is visible and captures a later foreground return', () => {
    let visibility = 'hidden'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility as DocumentVisibilityState)
    renderHook(() => useTeacherSurfaceAnalytics({ role: 'teacher', surface: 'daily', scope: 'private' }))
    expect(capture).not.toHaveBeenCalled()
    visibility = 'visible'
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(capture).toHaveBeenCalledTimes(1)
    visibility = 'hidden'
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    visibility = 'visible'
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(capture).toHaveBeenCalledTimes(2)
  })

  it('rejects unknown tabs and recognizes a new classroom without exporting its identifier', () => {
    const hook = renderHook((props) => useTeacherSurfaceAnalytics(props), {
      initialProps: { role: 'teacher', surface: 'unknown-private-value', scope: 'A' },
    })
    expect(capture).not.toHaveBeenCalled()
    hook.rerender({ role: 'teacher', surface: 'daily', scope: 'A' })
    hook.rerender({ role: 'teacher', surface: 'daily', scope: 'B' })
    expect(capture).toHaveBeenCalledTimes(2)
  })
})

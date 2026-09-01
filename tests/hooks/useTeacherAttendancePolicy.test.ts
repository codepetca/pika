import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTeacherAttendancePolicy } from '@/hooks/useTeacherAttendancePolicy'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'
import type { TeacherAttendancePolicy } from '@/lib/teacher-attendance-policy'

function policy(classroomId = 'classroom-a', overrides: Partial<TeacherAttendancePolicy> = {}): TeacherAttendancePolicy {
  return {
    classroomId, timezone: 'America/Toronto', sessionStartsLocal: '14:00', sessionEndsLocal: '15:00',
    sessionEndDayOffset: 0, entryOpensMinutesBefore: 10, presentGraceMinutes: 5,
    entryClosesMinutesBeforeEnd: 10, absentMinutesBeforeEnd: 0, enabled: true,
    revision: 1, updatedAt: '2026-08-31T17:00:00Z', ...overrides,
  }
}

function response(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200 })
}

describe('classroom-owned attendance policy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    invalidateCachedJSONMatching('teacher-attendance-policy:')
  })

  it('shows saved class hours, not QR offsets or a selected-date occurrence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ policy: policy() })))
    const { result } = renderHook(() => useTeacherAttendancePolicy('classroom-a', true))
    await waitFor(() => expect(result.current.label).toBe('2:00 PM - 3:00 PM'))
    expect(result.current.state).toBe('ready')
    expect(result.current.policy?.entryOpensMinutesBefore).toBe(10)
  })

  it('distinguishes missing policy from a failed read', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ policy: null }))
      .mockRejectedValueOnce(new Error('Unavailable'))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useTeacherAttendancePolicy('classroom-a', true))
    await waitFor(() => expect(result.current.state).toBe('ready'))
    expect(result.current.policy).toBeNull()
    await act(async () => { await result.current.refresh() })
    expect(result.current.state).toBe('error')
    expect(result.current.label).toBeNull()
  })

  it('hides the prior classroom immediately and ignores its late response', async () => {
    let resolveA!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveA = resolve }))
      .mockResolvedValueOnce(response({ policy: policy('classroom-b', { sessionStartsLocal: '16:00', sessionEndsLocal: '17:00' }) })))
    const { result, rerender } = renderHook(({ id }) => useTeacherAttendancePolicy(id, true), {
      initialProps: { id: 'classroom-a' },
    })
    rerender({ id: 'classroom-b' })
    expect(result.current.label).toBeNull()
    await waitFor(() => expect(result.current.label).toBe('4:00 PM - 5:00 PM'))
    await act(async () => { resolveA(response({ policy: policy() })) })
    expect(result.current.label).toBe('4:00 PM - 5:00 PM')
  })

  it('does not let an old read overwrite a newly saved policy', async () => {
    let resolveRead!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveRead = resolve })))
    const { result } = renderHook(() => useTeacherAttendancePolicy('classroom-a', true))
    act(() => result.current.acceptSaved(policy('classroom-a', { revision: 2, sessionEndsLocal: '16:00' })))
    await act(async () => { resolveRead(response({ policy: policy() })) })
    expect(result.current.label).toBe('2:00 PM - 4:00 PM')
  })

  it('labels overnight hours without using the selected date or browser timezone', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      policy: policy('classroom-a', { sessionStartsLocal: '23:00', sessionEndsLocal: '00:30', sessionEndDayOffset: 1 }),
    })))
    const { result } = renderHook(() => useTeacherAttendancePolicy('classroom-a', true))
    await waitFor(() => expect(result.current.label).toBe('11:00 PM - 12:30 AM (next day)'))
  })

  it('rejects a response belonging to a different classroom', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ policy: policy('classroom-b') })))
    const { result } = renderHook(() => useTeacherAttendancePolicy('classroom-a', true))
    await waitFor(() => expect(result.current.state).toBe('error'))
    expect(result.current.label).toBeNull()
  })

  it('keeps known saved hours visible during a refresh or failed refresh', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unavailable')))
    const { result } = renderHook(() => useTeacherAttendancePolicy('classroom-a', true))
    act(() => result.current.acceptSaved(policy()))
    expect(result.current.label).toBe('2:00 PM - 3:00 PM')
    await act(async () => { await result.current.refresh() })
    expect(result.current.state).toBe('error')
    expect(result.current.label).toBe('2:00 PM - 3:00 PM')
  })
})

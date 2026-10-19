import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StudentAttendanceCheckIn } from '@/app/attendance/check-in/[token]/StudentAttendanceCheckIn'
import { clearAuthoritativeStudentAttendanceConfirmation, fetchStudentAttendanceStatus, invalidateStudentAttendanceStatus } from '@/lib/student-attendance-client'

const confirmation = {
  state: 'checked_in', title: 'You are checked in', description: 'Recorded.',
  studentId: '30000000-0000-4000-8000-000000000001',
  classroomId: '20000000-0000-4000-8000-000000000001', classroomName: 'P5 - ICS3U',
  occurrenceBinding: 'a'.repeat(32), attendanceStatus: 'present', classDate: '2026-10-19',
  recordedAt: '2026-10-19T17:31:00.000Z', serverNow: '2026-10-19T17:31:01.000Z',
  validUntil: '2026-10-20T04:00:00.000Z',
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(confirmation.serverNow))
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})
afterEach(() => {
  cleanup()
  clearAuthoritativeStudentAttendanceConfirmation()
  invalidateStudentAttendanceStatus()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('confirmation page server revalidation with the real attendance client', () => {
  it.each(['open', 'confirmed'] as const)('uses the fresh %s result on focus instead of the previous POST', async (state) => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(confirmation))
      return new Response(JSON.stringify({
        studentId: confirmation.studentId, serverNow: confirmation.serverNow, nextRefreshAt: null,
        classrooms: [{ classroomId: confirmation.classroomId, state,
          classDate: confirmation.classDate, occurrenceBinding: confirmation.occurrenceBinding,
          opensAt: '2026-10-19T17:30:00.000Z', closesAt: '2026-10-19T18:30:00.000Z',
          ...(state === 'confirmed' ? { attendanceStatus: 'present', confirmedAt: confirmation.recordedAt, validUntil: confirmation.validUntil } : {}),
        }],
      }), { headers: { 'x-pika-student-id': confirmation.studentId } })
    })
    vi.stubGlobal('fetch', fetcher)
    await act(async () => { render(<StudentAttendanceCheckIn entryToken="token" canCheckIn />) })
    expect(screen.getByText('You are checked in')).toBeVisible()
    // Prime the normal banner cache and its acknowledged-POST handoff before
    // the confirmation page requests a strict, fresh server read.
    expect((await fetchStudentAttendanceStatus(confirmation.studentId)).classrooms[0].state).toBe('confirmed')
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    if (state === 'open') {
      expect(screen.queryByText('You are checked in')).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Scan today’s attendance QR' })).toBeVisible()
      expect((await fetchStudentAttendanceStatus(confirmation.studentId)).classrooms[0].state).toBe('open')
    } else expect(screen.getByText('You are checked in')).toBeVisible()
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/student/attendance/status')).toHaveLength(2)
  })
})

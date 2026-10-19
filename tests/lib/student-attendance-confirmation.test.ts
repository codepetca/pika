import { describe, expect, it } from 'vitest'
import { isCurrentAttendanceConfirmation, matchRefreshedAttendanceConfirmation } from '@/lib/student-attendance-confirmation'

const confirmation = {
  state: 'checked_in' as const, title: 'You are checked in', description: 'Recorded.',
  studentId: '30000000-0000-4000-8000-000000000001',
  classroomId: '20000000-0000-4000-8000-000000000001',
  occurrenceBinding: 'a'.repeat(32), attendanceStatus: 'present' as const,
  classDate: '2026-10-19', recordedAt: '2026-10-19T17:31:00.000Z',
  serverNow: '2026-10-19T17:31:01.000Z', validUntil: '2026-10-20T04:00:00.000Z',
}

describe('current attendance confirmation', () => {
  it('requires a backend success for the current Toronto class date', () => {
    expect(isCurrentAttendanceConfirmation(confirmation)).toBe(true)
    expect(isCurrentAttendanceConfirmation({ ...confirmation, state: 'closed' })).toBe(false)
    expect(isCurrentAttendanceConfirmation({ ...confirmation, classDate: '2026-10-16' })).toBe(false)
    expect(isCurrentAttendanceConfirmation({ ...confirmation, recordedAt: '2026-10-16T17:31:00.000Z' })).toBe(false)
    expect(isCurrentAttendanceConfirmation({ ...confirmation, validUntil: '2026-10-21T04:00:00.000Z' })).toBe(false)
  })

  it('expires at midnight and supports the Toronto DST boundary', () => {
    expect(isCurrentAttendanceConfirmation(confirmation, Date.parse(confirmation.validUntil))).toBe(false)
    expect(isCurrentAttendanceConfirmation({ ...confirmation,
      classDate: '2026-11-01', recordedAt: '2026-11-01T05:15:00.000Z',
      serverNow: '2026-11-01T06:15:00.000Z', validUntil: '2026-11-02T05:00:00.000Z',
    })).toBe(true)
  })

  it('revalidates only the same authenticated student, classroom, occurrence and date', () => {
    const view = {
      studentId: confirmation.studentId, serverNow: '2026-10-19T17:32:00.000Z', nextRefreshAt: null,
      classrooms: [{ classroomId: confirmation.classroomId, state: 'confirmed' as const,
        opensAt: '2026-10-19T17:30:00.000Z', closesAt: '2026-10-19T18:50:00.000Z',
        classDate: confirmation.classDate, occurrenceBinding: confirmation.occurrenceBinding,
        attendanceStatus: 'present' as const, confirmedAt: confirmation.recordedAt,
        validUntil: confirmation.validUntil }],
    }
    expect(matchRefreshedAttendanceConfirmation(confirmation, view)?.serverNow).toBe(view.serverNow)
    expect(matchRefreshedAttendanceConfirmation(confirmation, { ...view, studentId: 'other' })).toBeNull()
    for (const patch of [{ occurrenceBinding: 'b'.repeat(32) }, { classDate: '2026-10-16' }, { state: 'open' as const }]) {
      expect(matchRefreshedAttendanceConfirmation(confirmation, { ...view, classrooms: [{ ...view.classrooms[0], ...patch }] })).toBeNull()
    }
  })
})

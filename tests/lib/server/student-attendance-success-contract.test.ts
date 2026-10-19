import { describe, expect, it } from 'vitest'
import { studentAttendanceCheckInViewSchema } from '@/lib/validations/student-attendance'

const success = {
  state: 'checked_in', title: 'You are checked in', description: 'Recorded', attendanceStatus: 'present',
  recordedAt: '2026-09-02T13:01:00.000Z', classroomId: '20000000-0000-4000-8000-000000000001',
  studentId: '30000000-0000-4000-8000-000000000001', occurrenceBinding: 'a'.repeat(32),
  classDate: '2026-09-02', serverNow: '2026-09-02T13:02:00.000Z', validUntil: '2026-09-03T04:00:00.000Z',
}

describe('student check-in success contract', () => {
  it('accepts a complete server-authored success', () => {
    expect(studentAttendanceCheckInViewSchema.safeParse(success).success).toBe(true)
  })
  it.each(['recordedAt', 'classroomId', 'studentId', 'occurrenceBinding', 'classDate', 'serverNow', 'validUntil', 'attendanceStatus'])('rejects a success missing %s', key => {
    const incomplete: Record<string, unknown> = { ...success }
    delete incomplete[key]
    expect(studentAttendanceCheckInViewSchema.safeParse(incomplete).success).toBe(false)
    expect(studentAttendanceCheckInViewSchema.safeParse({ ...incomplete, state: 'already_checked_in' }).success).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MANUAL_ATTENDANCE_SETTINGS,
  deriveManualAttendanceStatus,
} from '@/lib/manual-attendance'
import {
  manualAttendanceMarksSchema,
  manualAttendanceSettingsSchema,
} from '@/lib/validations/manual-attendance'

describe('manual attendance', () => {
  it('derives Present from a completed Pika log unless a teacher overrides it', () => {
    expect(deriveManualAttendanceStatus({
      sourceMode: 'log',
      hasCompletedLog: true,
    })).toBe('present')
    expect(deriveManualAttendanceStatus({
      sourceMode: 'log',
      hasCompletedLog: true,
      override: 'late',
    })).toBe('late')
  })

  it('leaves students unmarked in explicit manual marking mode', () => {
    expect(deriveManualAttendanceStatus({
      sourceMode: 'manual',
      hasCompletedLog: true,
    })).toBe('unmarked')
    expect(DEFAULT_MANUAL_ATTENDANCE_SETTINGS).toEqual({
      sourceMode: 'manual',
      sessionStartsLocal: null,
      sessionEndsLocal: null,
    })
  })

  it('requires paired optional times and unique students', () => {
    const classroomId = '20000000-0000-4000-8000-000000000002'
    const studentId = '30000000-0000-4000-8000-000000000003'
    expect(manualAttendanceSettingsSchema.safeParse({
      classroom_id: classroomId,
      source_mode: 'log',
      session_starts_local: '09:00',
      session_ends_local: null,
    }).success).toBe(false)
    expect(manualAttendanceMarksSchema.safeParse({
      classroom_id: classroomId,
      date: '2026-05-06',
      student_ids: [studentId, studentId],
      status: 'present',
    }).success).toBe(false)
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MANUAL_ATTENDANCE_SETTINGS,
  deriveManualAttendanceStatus,
} from '@/lib/manual-attendance'
import {
  manualAttendanceMarksSchema,
  manualAttendanceSettingsSchema,
} from '@/lib/validations/manual-attendance'
import {
  loadManualAttendanceView,
  saveManualAttendanceMarks,
  saveManualAttendanceSettings,
} from '@/lib/server/manual-attendance'

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
      revision: 1,
    })
  })

  it('requires paired optional times and unique students', () => {
    const classroomId = '20000000-0000-4000-8000-000000000002'
    const studentId = '30000000-0000-4000-8000-000000000003'
    expect(manualAttendanceSettingsSchema.safeParse({
      classroom_id: classroomId,
      expected_revision: 1,
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

describe('manual attendance store', () => {
  it('reads settings and the selected date from archive-owned classroom rows', async () => {
    const classroomResult = {
      data: {
        manual_attendance_source_mode: 'log',
        manual_attendance_session_starts_local: '09:00:00',
        manual_attendance_session_ends_local: '10:00:00',
        manual_attendance_revision: 4,
      },
      error: null,
    }
    const enrollmentResult = {
      data: [
        {
          student_id: '30000000-0000-4000-8000-000000000003',
          manual_attendance_marks: {
            '2026-05-06': 'late',
            '2026-05-07': 'absent',
          },
        },
      ],
      error: null,
    }
    const supabase = {
      from: vi.fn((table: string) => table === 'classrooms'
        ? {
            select: () => ({
              eq: () => ({ single: () => Promise.resolve(classroomResult) }),
            }),
          }
        : {
            select: () => ({
              eq: () => Promise.resolve(enrollmentResult),
            }),
          }),
    }

    await expect(loadManualAttendanceView({
      supabase,
      classroomId: '20000000-0000-4000-8000-000000000002',
      classDate: '2026-05-06',
    })).resolves.toMatchObject({
      settings: {
        sourceMode: 'log',
        sessionStartsLocal: '09:00',
        sessionEndsLocal: '10:00',
        revision: 4,
      },
      overrides: [{
        studentId: '30000000-0000-4000-8000-000000000003',
        status: 'late',
      }],
    })
  })

  it('uses expected-revision settings writes and maps stale conflicts', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: {
          source_mode: 'manual',
          session_starts_local: null,
          session_ends_local: null,
          revision: 5,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: { code: '40001' } })
    const input = {
      supabase: { rpc },
      teacherId: '10000000-0000-4000-8000-000000000001',
      classroomId: '20000000-0000-4000-8000-000000000002',
      expectedRevision: 4,
      sourceMode: 'manual' as const,
      sessionStartsLocal: null,
      sessionEndsLocal: null,
    }

    await expect(saveManualAttendanceSettings(input)).resolves.toMatchObject({ revision: 5 })
    expect(rpc).toHaveBeenNthCalledWith(1, 'set_pika_manual_attendance_settings',
      expect.objectContaining({ p_expected_revision: 4 }))
    await expect(saveManualAttendanceSettings(input)).rejects.toMatchObject({
      code: 'stale_revision',
    })
  })

  it('maps a roster deletion race without misreporting the migration', async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: '23503', message: 'manual attendance roster changed' },
      }),
    }

    await expect(saveManualAttendanceMarks({
      supabase,
      teacherId: '10000000-0000-4000-8000-000000000001',
      classroomId: '20000000-0000-4000-8000-000000000002',
      classDate: '2026-05-06',
      studentIds: ['30000000-0000-4000-8000-000000000003'],
      status: 'present',
    })).rejects.toMatchObject({ code: 'roster_changed' })
  })
})

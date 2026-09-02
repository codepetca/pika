import { z } from 'zod'
import {
  ATTENDANCE_SESSION_TOO_LONG_MESSAGE,
  MAX_ATTENDANCE_SESSION_MINUTES,
  attendanceSessionDurationMinutes,
} from '@/lib/attendance-session-duration'

const classroomId = z.string().uuid()
const classDate = z.string().date()
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

export const manualAttendanceViewQuerySchema = z.object({
  classroom_id: classroomId,
  date: classDate,
}).strict()

export const manualAttendanceSettingsSchema = z.object({
  classroom_id: classroomId,
  expected_revision: z.number().int().positive(),
  source_mode: z.enum(['log', 'manual']),
  session_starts_local: localTime.nullable(),
  session_ends_local: localTime.nullable(),
}).strict().superRefine((value, context) => {
  if ((value.session_starts_local === null) !== (value.session_ends_local === null)) {
    context.addIssue({
      code: 'custom',
      path: ['session_ends_local'],
      message: 'Choose both attendance times or clear both',
    })
    return
  }
  if (value.session_starts_local !== null && value.session_ends_local !== null) {
    const duration = attendanceSessionDurationMinutes(
      value.session_starts_local,
      value.session_ends_local,
      0,
    )
    if (duration === null || duration <= 0) {
      context.addIssue({
        code: 'custom',
        path: ['session_ends_local'],
        message: 'Session end must be after session start',
      })
    } else if (duration > MAX_ATTENDANCE_SESSION_MINUTES) {
      context.addIssue({
        code: 'custom',
        path: ['session_ends_local'],
        message: ATTENDANCE_SESSION_TOO_LONG_MESSAGE,
      })
    }
  }
})

export const manualAttendanceMarksSchema = z.object({
  classroom_id: classroomId,
  date: classDate,
  student_ids: z.array(z.string().uuid()).min(1),
  status: z.enum(['automatic', 'present', 'late', 'absent']),
}).strict().superRefine((value, context) => {
  if (new Set(value.student_ids).size !== value.student_ids.length) {
    context.addIssue({
      code: 'custom',
      path: ['student_ids'],
      message: 'Each student may be marked once per request',
    })
  }
})

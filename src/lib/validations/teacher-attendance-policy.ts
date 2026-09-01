import { z } from 'zod'
import {
  ATTENDANCE_SESSION_TOO_LONG_MESSAGE,
  MAX_ATTENDANCE_SESSION_MINUTES,
  attendanceSessionDurationMinutes,
} from '@/lib/attendance-session-duration'

const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm')

export const teacherAttendancePolicyQuerySchema = z.object({
  classroom_id: z.string().uuid(),
}).strict()

export const teacherAttendancePolicyUpdateSchema = z.object({
  classroom_id: z.string().uuid(),
  session_starts_local: localTimeSchema,
  session_ends_local: localTimeSchema,
  session_end_day_offset: z.union([z.literal(0), z.literal(1)]),
  entry_opens_minutes_before: z.number().int().min(0).max(120),
  present_grace_minutes: z.number().int().min(0).max(MAX_ATTENDANCE_SESSION_MINUTES),
  entry_closes_minutes_before_end: z.number().int().min(0).max(MAX_ATTENDANCE_SESSION_MINUTES),
  absent_minutes_before_end: z.number().int().min(0).max(MAX_ATTENDANCE_SESSION_MINUTES),
  enabled: z.boolean(),
  expected_revision: z.number().int().safe().positive().nullable(),
}).strict().superRefine((value, context) => {
  const duration = attendanceSessionDurationMinutes(
    value.session_starts_local,
    value.session_ends_local,
    value.session_end_day_offset,
  )
  if (duration === null || duration <= 0) {
    context.addIssue({
      code: 'custom',
      path: ['session_ends_local'],
      message: 'Session end must be after session start',
    })
    return
  }
  if (duration > MAX_ATTENDANCE_SESSION_MINUTES) {
    context.addIssue({
      code: 'custom',
      path: ['session_ends_local'],
      message: ATTENDANCE_SESSION_TOO_LONG_MESSAGE,
    })
    return
  }
  for (const field of [
    'present_grace_minutes',
    'entry_closes_minutes_before_end',
    'absent_minutes_before_end',
  ] as const) {
    if (value[field] > duration) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: 'Timing rule cannot exceed the session duration',
      })
    }
  }
  if (value.present_grace_minutes >= duration - value.entry_closes_minutes_before_end) {
    context.addIssue({
      code: 'custom',
      path: ['present_grace_minutes'],
      message: 'The Present window must end before QR check-in closes',
    })
  }
  if (value.entry_closes_minutes_before_end < value.absent_minutes_before_end) {
    context.addIssue({
      code: 'custom',
      path: ['absent_minutes_before_end'],
      message: 'Students cannot become absent before QR check-in closes',
    })
  }
})

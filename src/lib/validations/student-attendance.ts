import { z } from 'zod'

export const studentAttendanceCheckInSchema = z.object({
  entryToken: z.string().regex(/^[A-Za-z0-9_-]{80,768}$/),
  attemptId: z.string().uuid(),
}).strict()

export const studentAttendanceCheckInViewSchema = z.object({
  state: z.enum(['checked_in', 'already_checked_in', 'needs_staff', 'closed', 'invalid']),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(240),
  attendanceStatus: z.enum(['present', 'late']).optional(),
  recordedAt: z.string().datetime({ offset: true }).optional(),
  classroomId: z.string().uuid().optional(),
}).strict()

export type StudentAttendanceCheckInView = z.infer<typeof studentAttendanceCheckInViewSchema>

export const studentAttendanceClassroomStateSchema = z.object({
  classroomId: z.string().uuid(),
  state: z.enum(['unavailable', 'no_session', 'scheduled', 'open', 'confirmed', 'closed']),
  opensAt: z.string().datetime({ offset: true }).nullable(),
  closesAt: z.string().datetime({ offset: true }).nullable(),
  attendanceStatus: z.enum(['present', 'late']).optional(),
  confirmedAt: z.string().datetime({ offset: true }).optional(),
}).strict()

export const studentAttendanceStatusViewSchema = z.object({
  classrooms: z.array(studentAttendanceClassroomStateSchema).max(50),
  nextRefreshAt: z.string().datetime({ offset: true }).nullable(),
}).strict()

export type StudentAttendanceClassroomState = z.infer<
  typeof studentAttendanceClassroomStateSchema
>
export type StudentAttendanceStatusView = z.infer<typeof studentAttendanceStatusViewSchema>

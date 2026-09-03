import { z } from 'zod'

export const ATTENDANCE_CLASSROOM_DECOMMISSION_REQUIRED_MESSAGE =
  'Attendance must be decommissioned before this classroom can be permanently removed' as const

export const attendanceDecommissionParamsSchema = z.object({
  id: z.string().uuid(), operationId: z.string().uuid(),
}).strict()
export const attendanceDecommissionStartSchema = z.object({
  operation_id: z.string().uuid(), confirmation: z.string().min(1).max(300),
}).strict()
export const attendanceDecommissionClassroomSchema = z.object({ id: z.string().uuid() }).strict()

export const attendanceDecommissionStatusSchema = z.object({
  operation_id: z.string().uuid(),
  state: z.enum(['fenced', 'remote_deleted', 'local_deleted']),
  deleted_count: z.number().int().nonnegative(),
  attendance_removed: z.boolean(),
  classroom_deleted: z.literal(false),
}).strict()

export type AttendanceDecommissionStatus = z.infer<typeof attendanceDecommissionStatusSchema>

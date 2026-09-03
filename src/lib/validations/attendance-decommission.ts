import { z } from 'zod'

export const attendanceDecommissionParamsSchema = z.object({
  id: z.string().uuid(), operationId: z.string().uuid(),
}).strict()
export const attendanceDecommissionStartSchema = z.object({
  operation_id: z.string().uuid(), confirmation: z.string().min(1).max(300),
}).strict()
export const attendanceDecommissionClassroomSchema = z.object({ id: z.string().uuid() }).strict()

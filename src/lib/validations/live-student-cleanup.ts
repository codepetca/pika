import { z } from 'zod'

export const liveStudentCleanupParamsSchema = z.object({ id: z.string().uuid(), studentId: z.string().uuid() })
export const liveStudentCleanupQuerySchema = z.object({
  operation_id: z.string().uuid(), generation_id: z.string().uuid(),
}).strict()
export const liveStudentCleanupRequestSchema = liveStudentCleanupQuerySchema.extend({
  action: z.enum(['reserve', 'advance']),
  confirmation: z.literal('PURGE LIVE CLASSROOM DATA'),
}).strict()

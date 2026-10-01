import { z } from 'zod'

export const contextualTeacherLogsQuerySchema = z.object({
  classroom_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

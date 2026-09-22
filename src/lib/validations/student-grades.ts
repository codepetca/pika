import { z } from 'zod'

export const studentGradesParamsSchema = z.object({
  id: z.string().uuid(),
})

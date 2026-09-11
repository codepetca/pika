import { z } from 'zod'

export const studentGradebookItemsParamsSchema = z.object({
  id: z.string().uuid(),
})

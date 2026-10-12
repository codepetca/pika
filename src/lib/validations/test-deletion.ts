import { z } from 'zod'

export const testDeletionParamsSchema = z.object({ id: z.string().uuid().transform(value => value.toLowerCase()) }).strict()
export const testDeletionResultSchema = z.object({
  deleted: z.literal(true),
  responses_count: z.number().int().nonnegative(),
}).strict()

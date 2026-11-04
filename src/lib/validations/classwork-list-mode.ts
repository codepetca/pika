import { z } from 'zod'

/** The optional list mode may appear at most once. */
export const classworkListModeQuerySchema = z.object({
  summary: z.array(z.literal('1')).max(1),
}).strict()

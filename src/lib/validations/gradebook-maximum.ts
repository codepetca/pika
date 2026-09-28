import { z } from 'zod'

export const gradebookMaximumPutSchema = z.object({
  classroom_id: z.string().uuid(),
  assessment_type: z.enum(['assignment', 'test', 'item']),
  assessment_id: z.string().uuid(),
  maximum: z.number().finite().min(0.1).max(999999.9).multipleOf(0.1).nullable(),
  mode: z.enum(['keep_marks', 'preserve_percentages', 'reset']),
  expected_maximum: z.number().finite().min(0),
  expected_scale: z.number().finite().positive(),
}).strict().refine((value) => value.mode === 'reset' ? value.maximum === null : value.maximum != null, 'Choose a maximum or reset it')
export type GradebookMaximumPut = z.infer<typeof gradebookMaximumPutSchema>

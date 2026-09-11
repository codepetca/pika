import { z } from 'zod'

const target = { classroom_id: z.uuid(), item_id: z.uuid() }
const details = {
  title: z.string().trim().min(1).max(200),
  points_possible: z.number().min(0.1).max(999999.9).multipleOf(0.1),
  gradebook_category_id: z.uuid().nullable(),
  gradebook_weight: z.number().int().min(1).max(999),
  include_in_final: z.boolean(),
}
export const gradebookItemMutationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), ...target, ...details }).strict(),
  z.object({ action: z.literal('update'), ...target, ...details }).strict(),
  z.object({ action: z.literal('weight'), ...target, gradebook_weight: details.gradebook_weight }).strict(),
  z.object({ action: z.literal('delete'), ...target }).strict(),
  z.object({ action: z.literal('return_marks'), ...target }).strict(),
])
export const gradebookItemScoreSchema = z.object({
  ...target,
  student_id: z.uuid(),
  earned: z.number().min(0).max(999999.9).multipleOf(0.1).nullable(),
}).strict()
export type GradebookItemMutation = z.infer<typeof gradebookItemMutationSchema>
export type GradebookItemScore = z.infer<typeof gradebookItemScoreSchema>

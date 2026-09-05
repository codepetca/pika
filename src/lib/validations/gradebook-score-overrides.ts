import { z } from 'zod'

const overrideBaseSchema = z.object({
  classroom_id: z.string().uuid(),
  student_id: z.string().uuid(),
}).strict()

const assessmentOverrideIdentitySchema = overrideBaseSchema.extend({
  assessment_type: z.enum(['assignment', 'test']),
  assessment_id: z.string().uuid(),
}).strict()

const finalOverrideIdentitySchema = overrideBaseSchema.extend({
  assessment_type: z.literal('final'),
  // Final overrides use the classroom id as their stable per-student target key.
  assessment_id: z.string().uuid(),
}).strict()

const earnedSchema = z.number().finite().min(0).max(999999.9).multipleOf(0.1)

export const gradebookScoreOverridePutSchema = z.union([
  assessmentOverrideIdentitySchema.extend({ earned: earnedSchema }).strict(),
  finalOverrideIdentitySchema.extend({ earned: earnedSchema }).strict(),
])

export const gradebookScoreOverrideDeleteSchema = z.union([
  assessmentOverrideIdentitySchema.extend({ scope: z.literal('one') }).strict(),
  finalOverrideIdentitySchema.extend({ scope: z.literal('one') }).strict(),
  z.object({
    scope: z.literal('all'),
    classroom_id: z.string().uuid(),
  }).strict(),
])

export type GradebookScoreOverridePutCommand = z.infer<typeof gradebookScoreOverridePutSchema>
export type GradebookScoreOverrideDeleteCommand = z.infer<typeof gradebookScoreOverrideDeleteSchema>

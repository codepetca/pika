import { z } from 'zod'

const overrideBaseSchema = z.object({
  classroom_id: z.string().trim().min(1, 'classroom_id is required'),
  student_id: z.string().trim().min(1, 'student_id is required'),
})

const assessmentOverrideIdentitySchema = overrideBaseSchema.extend({
  assessment_type: z.enum(['assignment', 'test']),
  assessment_id: z.string().trim().min(1, 'assessment_id is required'),
})

const finalOverrideIdentitySchema = overrideBaseSchema.extend({
  assessment_type: z.literal('final'),
  // Final overrides use the classroom id as their stable per-student target key.
  assessment_id: z.string().trim().min(1, 'assessment_id is required'),
})

const earnedSchema = z.object({
  earned: z.number().finite().min(0).max(999999.9).multipleOf(0.1),
})

export const gradebookScoreOverridePutSchema = z.union([
  assessmentOverrideIdentitySchema.and(earnedSchema),
  finalOverrideIdentitySchema.and(earnedSchema),
])

export const gradebookScoreOverrideDeleteSchema = z.union([
  assessmentOverrideIdentitySchema,
  finalOverrideIdentitySchema,
  z.object({
    classroom_id: z.string().trim().min(1, 'classroom_id is required'),
    all: z.literal(true),
  }),
])

export type GradebookScoreOverridePutCommand = z.infer<typeof gradebookScoreOverridePutSchema>
export type GradebookScoreOverrideDeleteCommand = z.infer<typeof gradebookScoreOverrideDeleteSchema>

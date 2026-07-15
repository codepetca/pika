import { z } from 'zod'

const ASSESSMENT_WEIGHT_MAX = 999

export const gradebookQuerySchema = z.object({
  classroom_id: z.string().min(1, 'classroom_id is required'),
  student_id: z.string().trim().nullable().optional().transform((value) => value || null),
})

function normalizeRequestObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

const gradebookPatchInputSchema = z.preprocess(normalizeRequestObject, z.object({
  classroom_id: z.unknown().optional(),
  assessment_type: z.unknown().optional(),
  assessment_id: z.unknown().optional(),
  gradebook_weight: z.unknown().optional(),
  use_weights: z.unknown().optional(),
  assignments_weight: z.unknown().optional(),
  quizzes_weight: z.unknown().optional(),
  tests_weight: z.unknown().optional(),
}).passthrough())

const gradebookPatchCommandSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('assessment_weight'),
    classroomId: z.string(),
    assessmentType: z.enum(['assignment', 'test']),
    assessmentId: z.string(),
    gradebookWeight: z.number().int(),
  }),
  z.object({
    kind: z.literal('legacy_category_settings'),
    classroomId: z.string(),
  }),
])

function parseRequiredId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return value.trim() || null
}

function parseAssessmentWeight(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return /^\d+$/.test(normalized) ? Number(normalized) : null
}

export const gradebookPatchSchema = gradebookPatchInputSchema.transform((body, context) => {
  const classroomId = parseRequiredId(body.classroom_id)
  if (!classroomId) {
    context.addIssue({ code: 'custom', message: 'classroom_id is required' })
    return z.NEVER
  }

  const hasAssessmentWeightUpdate =
    body.assessment_type != null ||
    body.assessment_id != null ||
    body.gradebook_weight != null
  const hasLegacyCategorySettingsUpdate =
    body.use_weights != null ||
    body.assignments_weight != null ||
    body.quizzes_weight != null ||
    body.tests_weight != null

  if (hasAssessmentWeightUpdate) {
    if (body.assessment_type !== 'assignment' && body.assessment_type !== 'test') {
      context.addIssue({ code: 'custom', message: 'assessment_type must be assignment or test' })
      return z.NEVER
    }

    const assessmentId = parseRequiredId(body.assessment_id)
    if (!assessmentId) {
      context.addIssue({ code: 'custom', message: 'assessment_id is required' })
      return z.NEVER
    }

    const gradebookWeight = parseAssessmentWeight(body.gradebook_weight)
    if (
      gradebookWeight == null ||
      gradebookWeight < 1 ||
      gradebookWeight > ASSESSMENT_WEIGHT_MAX
    ) {
      context.addIssue({
        code: 'custom',
        message: `gradebook_weight must be an integer 1-${ASSESSMENT_WEIGHT_MAX}`,
      })
      return z.NEVER
    }

    return {
      kind: 'assessment_weight',
      classroomId,
      assessmentType: body.assessment_type,
      assessmentId,
      gradebookWeight,
    }
  }

  if (hasLegacyCategorySettingsUpdate) {
    return { kind: 'legacy_category_settings', classroomId }
  }

  context.addIssue({ code: 'custom', message: 'No gradebook update provided' })
  return z.NEVER
}).pipe(gradebookPatchCommandSchema)

export type GradebookPatchCommand = z.infer<typeof gradebookPatchSchema>

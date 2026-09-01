import { z } from 'zod'

const ASSESSMENT_WEIGHT_MAX = 999
const GRADEBOOK_CATEGORY_MAX = 20

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
  gradebook_category_id: z.unknown().optional(),
  gradebook_weight: z.unknown().optional(),
  use_weights: z.unknown().optional(),
  assignments_weight: z.unknown().optional(),
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
    kind: z.literal('assessment_details'),
    classroomId: z.string(),
    assessmentType: z.enum(['assignment', 'test']),
    assessmentId: z.string(),
    gradebookCategoryId: z.string().uuid().nullable(),
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
    body.gradebook_weight != null ||
    body.gradebook_category_id !== undefined
  const hasLegacyCategorySettingsUpdate =
    body.use_weights != null ||
    body.assignments_weight != null ||
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

    const categoryId = body.gradebook_category_id === null
      ? null
      : parseRequiredId(body.gradebook_category_id)
    if (body.gradebook_category_id !== undefined && categoryId === null && body.gradebook_category_id !== null) {
      context.addIssue({ code: 'custom', message: 'gradebook_category_id must be a UUID or null' })
      return z.NEVER
    }
    if (categoryId != null && !z.uuid().safeParse(categoryId).success) {
      context.addIssue({ code: 'custom', message: 'gradebook_category_id must be a UUID or null' })
      return z.NEVER
    }

    return {
      kind: body.gradebook_category_id === undefined ? 'assessment_weight' : 'assessment_details',
      classroomId,
      assessmentType: body.assessment_type,
      assessmentId,
      gradebookWeight,
      ...(body.gradebook_category_id !== undefined ? { gradebookCategoryId: categoryId } : {}),
    }
  }

  if (hasLegacyCategorySettingsUpdate) {
    return { kind: 'legacy_category_settings', classroomId }
  }

  context.addIssue({ code: 'custom', message: 'No gradebook update provided' })
  return z.NEVER
}).pipe(gradebookPatchCommandSchema)

export type GradebookPatchCommand = z.infer<typeof gradebookPatchSchema>

const gradebookCategoryInputSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  percentage: z.number().min(0).max(100).multipleOf(0.01),
  default_assessment_weight: z.number().int().min(1).max(ASSESSMENT_WEIGHT_MAX),
  is_default: z.boolean(),
})

export const gradebookCategoriesPutSchema = z.object({
  classroom_id: z.string().trim().min(1, 'classroom_id is required'),
  categories: z.array(gradebookCategoryInputSchema).min(1).max(GRADEBOOK_CATEGORY_MAX),
}).superRefine((value, context) => {
  const names = value.categories.map((category) => category.name.toLocaleLowerCase())
  if (new Set(names).size !== names.length) {
    context.addIssue({ code: 'custom', path: ['categories'], message: 'Category names must be unique' })
  }

  const ids = value.categories.map((category) => category.id)
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', path: ['categories'], message: 'Category IDs must be unique' })
  }

  const defaultCount = value.categories.filter((category) => category.is_default).length
  if (defaultCount !== 1) {
    context.addIssue({ code: 'custom', path: ['categories'], message: 'Choose exactly one default category' })
  }

  const total = value.categories.reduce((sum, category) => sum + category.percentage, 0)
  if (Math.abs(total - 100) > 0.001) {
    context.addIssue({
      code: 'custom',
      path: ['categories'],
      message: `Category percentages must total 100 (currently ${Math.round(total * 100) / 100})`,
    })
  }
}).transform((value) => ({
  classroomId: value.classroom_id,
  categories: value.categories.map((category, position) => ({
    id: category.id,
    name: category.name,
    percentage: category.percentage,
    defaultAssessmentWeight: category.default_assessment_weight,
    position,
    isDefault: category.is_default,
  })),
}))

export type GradebookCategoriesPutCommand = z.infer<typeof gradebookCategoriesPutSchema>

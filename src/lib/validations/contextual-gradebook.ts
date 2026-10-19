import { z } from 'zod'

/** Technical availability bounds, independent of entitlements and product quotas. */
export const GRADEBOOK_LIMITS = {
  roster: 1_000, profiles: 1_000, categories: 20, assignments: 1_000, tests: 1_000,
  items: 1_000, assessments: 2_000, test_questions: 50_000, questionsPerTest: 500,
  assignment_docs: 100_000, test_attempts: 100_000, item_scores: 100_000,
  test_responses: 500_000, score_overrides: 201_000, ownerCells: 200_000,
  stringBytes: 16_384, expandedBytes: 16_777_216, sourceBytes: 20_971_520,
  transportBytes: 25_165_824, payloadBytes: 65_536, lifetimeMs: 8_000,
} as const

const uuid = z.uuid().refine((value) => value === value.toLowerCase(), 'UUID must be canonical lowercase')
const timestamp = z.iso.datetime({ offset: true })
const number = z.number().finite()
const text = z.string().refine((value) => new TextEncoder().encode(value).byteLength <= GRADEBOOK_LIMITS.stringBytes, 'String exceeds byte limit')
const weight = number.int().min(0).max(999)
const maximumFields = {
  gradebook_maximum_override: number.min(0.1).max(999999.9).nullable(),
  gradebook_score_scale: number.min(1e-12).max(1e12),
}
const assessmentFields = {
  id: uuid, classroom_id: uuid, title: text, include_in_final: z.boolean(),
  gradebook_weight: weight, gradebook_category_id: uuid.nullable(), ...maximumFields,
}
export const contextualGradebookCategorySchema = z.object({
  id: uuid, classroom_id: uuid, name: text.min(1).max(80), percentage: number.min(0).max(100),
  default_assessment_weight: number.int().min(1).max(999), position: number.int(), is_default: z.boolean(),
}).strict()
export const contextualGradebookAssignmentSchema = z.object({
  ...assessmentFields, due_at: timestamp, position: number.int(), is_draft: z.boolean(), points_possible: number,
}).strict()
export const contextualGradebookTestSchema = z.object({
  ...assessmentFields, position: number.int(), status: z.enum(['draft', 'active', 'closed']),
}).strict()
export const contextualGradebookItemSchema = z.object({
  ...assessmentFields, points_possible: number, created_at: timestamp,
}).strict()
const assignmentDocSchema = z.object({
  assignment_id: uuid, student_id: uuid, score_completion: number.nullable(), score_thinking: number.nullable(),
  score_workflow: number.nullable(), is_submitted: z.boolean(), submitted_at: timestamp.nullable(),
  returned_at: timestamp.nullable(), teacher_cleared_at: timestamp.nullable(), graded_at: timestamp.nullable(),
}).strict()
const questionSchema = z.object({ id: uuid, test_id: uuid, points: number }).strict()
const responseSchema = z.object({ test_id: uuid, question_id: uuid, student_id: uuid, score: number.nullable() }).strict()
const attemptSchema = z.object({ test_id: uuid, student_id: uuid, is_submitted: z.boolean(), submitted_at: timestamp.nullable(), returned_at: timestamp.nullable() }).strict()
const itemScoreSchema = z.object({ item_id: uuid, classroom_id: uuid, student_id: uuid, earned: number, returned_at: timestamp.nullable(), updated_at: timestamp }).strict()
const overrideSchema = z.object({ classroom_id: uuid, student_id: uuid, assessment_type: z.enum(['assignment', 'test', 'final']), assessment_id: uuid, earned: number }).strict()
const sources = {
  categories: z.array(contextualGradebookCategorySchema).max(GRADEBOOK_LIMITS.categories),
  assignments: z.array(contextualGradebookAssignmentSchema).max(GRADEBOOK_LIMITS.assignments),
  assignment_docs: z.array(assignmentDocSchema).max(GRADEBOOK_LIMITS.assignment_docs),
  tests: z.array(contextualGradebookTestSchema).max(GRADEBOOK_LIMITS.tests),
  test_questions: z.array(questionSchema).max(GRADEBOOK_LIMITS.test_questions),
  test_responses: z.array(responseSchema).max(GRADEBOOK_LIMITS.test_responses),
  test_attempts: z.array(attemptSchema).max(GRADEBOOK_LIMITS.test_attempts),
  items: z.array(contextualGradebookItemSchema).max(GRADEBOOK_LIMITS.items),
  item_scores: z.array(itemScoreSchema).max(GRADEBOOK_LIMITS.item_scores),
  score_overrides: z.array(overrideSchema).max(GRADEBOOK_LIMITS.score_overrides),
}
export const contextualGradebookOwnerSourceSchema = z.object({
  ...sources,
  roster: z.array(z.object({ student_id: uuid, email: text }).strict()).max(GRADEBOOK_LIMITS.roster),
  profiles: z.array(z.object({ user_id: uuid, student_number: text.nullable(), first_name: text.nullable(), last_name: text.nullable() }).strict()).max(GRADEBOOK_LIMITS.profiles),
}).strict()
export const contextualGradebookVisibilitySchema = z.object({
  classwork: z.boolean(), tests: z.boolean(), student_grades: z.boolean(), gradebook_compact_zero_weight_assessments: z.boolean(),
}).strict()
export const contextualGradebookMemberSourceSchema = z.object({
  student_id: uuid, visibility: contextualGradebookVisibilitySchema, ...sources,
}).strict()
const envelope = {
  actor_id: uuid, classroom: z.object({ id: uuid, teacher_id: uuid, archived_at: timestamp.nullable() }).strict(),
}
export const contextualGradebookOwnerEnvelopeSchema = z.object({
  ...envelope, operation: z.literal('owner-read'), selected_student_id: uuid.nullable(), source: contextualGradebookOwnerSourceSchema,
}).strict()
export const contextualGradebookMemberGradesEnvelopeSchema = z.object({
  ...envelope, operation: z.literal('member-grades'), source: contextualGradebookMemberSourceSchema,
}).strict()
export const contextualGradebookMemberItemsEnvelopeSchema = z.object({
  ...envelope, operation: z.literal('member-items'), source: contextualGradebookMemberSourceSchema,
}).strict()

const assessment = { assessment_type: z.enum(['assignment', 'test']), assessment_id: uuid }
const overrideTarget = { student_id: uuid, assessment_type: z.enum(['assignment', 'test', 'final']), assessment_id: uuid }
const mark = number.min(0).max(999999.9).multipleOf(0.1)
const itemDetails = {
  item_id: uuid, title: z.string().trim().min(1).max(200), points_possible: number.min(0.1).max(999999.9).multipleOf(0.1),
  gradebook_category_id: uuid.nullable(), gradebook_weight: weight, include_in_final: z.boolean(),
}
const categoryInput = contextualGradebookCategorySchema.omit({ classroom_id: true }).extend({
  percentage: number.min(0).max(100).multipleOf(0.01), position: number.int().min(0),
  name: z.string().trim().min(1).max(80).refine((value) => !value.toLowerCase().startsWith('__pika_replacing__')),
})
export const contextualGradebookMutationPayloadSchemas = {
  assessment_weight: z.object({ ...assessment, gradebook_weight: weight }).strict(),
  assessment_details: z.object({ ...assessment, gradebook_weight: weight, gradebook_category_id: uuid.nullable() }).strict(),
  categories_replace: z.object({ categories: z.array(categoryInput).min(1).max(20) }).strict().superRefine(({ categories }, ctx) => {
    if (new Set(categories.map((row) => row.id)).size !== categories.length
      || new Set(categories.map((row) => row.name.toLowerCase())).size !== categories.length
      || categories.filter((row) => row.is_default).length !== 1
      || Math.abs(categories.reduce((sum, row) => sum + row.percentage, 0) - 100) > 0.001
      || categories.some((row, index) => row.position !== index)) ctx.addIssue({ code: 'custom', message: 'Invalid category replacement' })
  }),
  override_save: z.object({ ...overrideTarget, earned: mark }).strict(),
  override_delete_one: z.object(overrideTarget).strict(),
  override_delete_all: z.object({}).strict(),
  item_create: z.object(itemDetails).strict(),
  item_update: z.object(itemDetails).strict(),
  item_weight: z.object({ item_id: uuid, gradebook_weight: weight }).strict(),
  item_delete: z.object({ item_id: uuid }).strict(),
  item_return_marks: z.object({ item_id: uuid }).strict(),
  item_score: z.object({ item_id: uuid, student_id: uuid, earned: mark.nullable() }).strict(),
  maximum: z.object({ assessment_type: z.enum(['assignment', 'test', 'item']), assessment_id: uuid,
    maximum: mark.positive().nullable(), mode: z.enum(['keep_marks', 'preserve_percentages', 'reset']),
    expected_maximum: number.min(0), expected_scale: number.positive(),
  }).strict().refine((value) => value.mode === 'reset' ? value.maximum === null : value.maximum !== null),
} as const
export const contextualGradebookMutationActionSchema = z.enum([
  'assessment_weight', 'assessment_details', 'categories_replace', 'override_save', 'override_delete_one',
  'override_delete_all', 'item_create', 'item_update', 'item_weight', 'item_delete', 'item_return_marks', 'item_score', 'maximum',
])
export const contextualGradebookMutationPayloadSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assessment_weight'), payload: contextualGradebookMutationPayloadSchemas.assessment_weight }).strict(),
  z.object({ action: z.literal('assessment_details'), payload: contextualGradebookMutationPayloadSchemas.assessment_details }).strict(),
  z.object({ action: z.literal('categories_replace'), payload: contextualGradebookMutationPayloadSchemas.categories_replace }).strict(),
  z.object({ action: z.literal('override_save'), payload: contextualGradebookMutationPayloadSchemas.override_save }).strict(),
  z.object({ action: z.literal('override_delete_one'), payload: contextualGradebookMutationPayloadSchemas.override_delete_one }).strict(),
  z.object({ action: z.literal('override_delete_all'), payload: contextualGradebookMutationPayloadSchemas.override_delete_all }).strict(),
  z.object({ action: z.literal('item_create'), payload: contextualGradebookMutationPayloadSchemas.item_create }).strict(),
  z.object({ action: z.literal('item_update'), payload: contextualGradebookMutationPayloadSchemas.item_update }).strict(),
  z.object({ action: z.literal('item_weight'), payload: contextualGradebookMutationPayloadSchemas.item_weight }).strict(),
  z.object({ action: z.literal('item_delete'), payload: contextualGradebookMutationPayloadSchemas.item_delete }).strict(),
  z.object({ action: z.literal('item_return_marks'), payload: contextualGradebookMutationPayloadSchemas.item_return_marks }).strict(),
  z.object({ action: z.literal('item_score'), payload: contextualGradebookMutationPayloadSchemas.item_score }).strict(),
  z.object({ action: z.literal('maximum'), payload: contextualGradebookMutationPayloadSchemas.maximum }).strict(),
])
const saved = z.object({ saved: z.literal(true) }).strict()
const deleted = z.object({ deleted: z.literal(true) }).strict()
const itemResult = z.object({ ok: z.literal(true), item: contextualGradebookItemSchema.extend({ created_by: uuid, updated_at: timestamp }) }).strict()
const assessmentTarget = z.object(assessment).strict()
const maximumTarget = z.object({ assessment_type: z.enum(['assignment', 'test', 'item']), assessment_id: uuid }).strict()
const markTarget = z.object(overrideTarget).strict()
const itemTarget = z.object({ item_id: uuid }).strict()
const itemScoreTarget = z.object({ item_id: uuid, student_id: uuid }).strict()
export const contextualGradebookMutationEnvelopeSchema = z.discriminatedUnion('operation', [
  z.object({ ...envelope, operation: z.literal('assessment_weight'), target: assessmentTarget, result: z.object({ assessment: z.object({ assessment_id: uuid, assessment_type: assessment.assessment_type, weight }).strict() }).strict() }).strict(),
  z.object({ ...envelope, operation: z.literal('assessment_details'), target: assessmentTarget, result: z.object({ assessment: z.object({ assessment_id: uuid, assessment_type: assessment.assessment_type, weight, category_id: uuid.nullable() }).strict() }).strict() }).strict(),
  z.object({ ...envelope, operation: z.literal('categories_replace'), target: z.object({ category_ids: z.array(uuid).min(1).max(20) }).strict(), result: z.object({ categories: z.array(contextualGradebookCategorySchema).min(1).max(20) }).strict() }).strict(),
  z.object({ ...envelope, operation: z.literal('override_save'), target: markTarget, result: saved }).strict(),
  z.object({ ...envelope, operation: z.literal('override_delete_one'), target: markTarget, result: deleted }).strict(),
  z.object({ ...envelope, operation: z.literal('override_delete_all'), target: z.object({}).strict(), result: deleted }).strict(),
  z.object({ ...envelope, operation: z.literal('item_create'), target: itemTarget, result: itemResult }).strict(),
  z.object({ ...envelope, operation: z.literal('item_update'), target: itemTarget, result: itemResult }).strict(),
  z.object({ ...envelope, operation: z.literal('item_weight'), target: itemTarget, result: itemResult }).strict(),
  z.object({ ...envelope, operation: z.literal('item_delete'), target: itemTarget, result: z.object({ ok: z.literal(true), deleted: z.literal(true) }).strict() }).strict(),
  z.object({ ...envelope, operation: z.literal('item_return_marks'), target: itemTarget, result: z.object({ ok: z.literal(true), returned_count: number.int().min(0).max(100_000) }).strict() }).strict(),
  z.object({ ...envelope, operation: z.literal('item_score'), target: itemScoreTarget, result: saved }).strict(),
  z.object({ ...envelope, operation: z.literal('maximum'), target: maximumTarget, result: saved }).strict(),
])
export type GradebookOwnerSource = z.infer<typeof contextualGradebookOwnerSourceSchema>
export type GradebookMemberSource = z.infer<typeof contextualGradebookMemberSourceSchema>
export type GradebookMutationAction = z.infer<typeof contextualGradebookMutationActionSchema>
export type GradebookMutationPayload = z.infer<typeof contextualGradebookMutationPayloadSchema>
export type GradebookMutationResult = z.infer<typeof contextualGradebookMutationEnvelopeSchema>['result']

import { z } from 'zod'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import { contextualTestDetailDraftSchema } from '@/lib/validations/contextual-test-detail-read'

export const TEST_LIST_PAGE_SIZE = 1000
export const TEST_LIST_BATCH_SIZE = 50
export const TEST_LIST_CHILD_PAGE_SIZE = 100
export const TEST_LIST_COLLECTION_LIMIT = 10000
export const TEST_LIST_AGGREGATE_LIMIT = 100000
export const TEST_LIST_STATEMENT_LIMIT = 1024
export const TEST_LIST_DEADLINE_MS = 20000
export const TEST_LIST_DTO_BYTES = 8 * 1024 * 1024
export const TEST_LIST_TOTAL_BYTES = 64 * 1024 * 1024
const uuid = z.string().uuid().refine(value => value === value.toLowerCase())
const inputUuid = z.string().uuid().transform(value => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)))
export const contextualTestListQuerySchema = z.object({ classroomId: inputUuid }).strict()
export const contextualTestListIdentitySchema = contextualTestListQuerySchema.extend({ actorId: inputUuid }).strict()
export const contextualTestListClassroomSchema = z.object({ id: uuid, teacher_id: uuid, archived_at: timestamp.nullable() }).strict()
export const contextualTestListEnrollmentSchema = z.object({ classroom_id: uuid, student_id: uuid }).strict()
export const contextualTestListControlSchema = z.object({ id: uuid, classroom_id: uuid, status: z.enum(['draft', 'active', 'closed']), updated_at: timestamp }).strict()
const json = z.unknown().refine(value => boundedAssignmentListJson(value, 2 * 1024 * 1024)).pipe(z.json())
/** Every generated tests.Row column is preserved; documents retain legacy normalization. */
export const contextualTestListTestSchema = contextualTestListControlSchema.extend({
  artifact_id: uuid, blueprint_archived_at: timestamp.nullable(), created_at: timestamp, created_by: uuid, documents: json,
  gradebook_category_id: uuid.nullable(), gradebook_maximum_override: z.number().finite().nullable(), gradebook_score_scale: z.number().finite(),
  gradebook_weight: z.number().finite(), include_in_final: z.boolean(), points_possible: z.number().finite(), position: z.number().int(),
  questions_locked_at: timestamp.nullable(), show_results: z.boolean(), source_artifact_id: uuid.nullable(), source_blueprint_version_id: uuid.nullable(), title: z.string(),
}).strict()
export const contextualTestListQuestionSchema = z.object({ id: uuid, test_id: uuid }).strict()
const student = z.object({
  id: uuid, test_id: uuid, student_id: uuid,
  participant: z.object({ id: uuid, enrollment: z.array(contextualTestListEnrollmentSchema).length(1) }).strict(),
}).strict()
export const contextualTestListAttemptSchema = student.extend({ is_submitted: z.boolean() }).strict()
export const contextualTestListResponseSchema = student.extend({ selected_option: z.number().int().nonnegative().nullable(), response_text: z.string().nullable() }).strict()
export const contextualTestListAvailabilitySchema = student.extend({ state: z.enum(['open', 'closed']) }).strict()
export const contextualTestListDraftSchema = contextualTestDetailDraftSchema
export const contextualTestListParentSchema = contextualTestListControlSchema.extend({
  questions: z.array(contextualTestListQuestionSchema).max(TEST_LIST_CHILD_PAGE_SIZE).optional(),
  attempts: z.array(contextualTestListAttemptSchema).max(TEST_LIST_CHILD_PAGE_SIZE).optional(),
  responses: z.array(contextualTestListResponseSchema).max(TEST_LIST_CHILD_PAGE_SIZE).optional(),
  availability: z.array(contextualTestListAvailabilitySchema).max(TEST_LIST_CHILD_PAGE_SIZE).optional(),
}).strict()
export const contextualTestListRootSchema = contextualTestListClassroomSchema.extend({
  tests: z.array(z.union([contextualTestListTestSchema, contextualTestListParentSchema])).max(TEST_LIST_PAGE_SIZE).optional(),
  enrollments: z.array(contextualTestListEnrollmentSchema).max(TEST_LIST_PAGE_SIZE).optional(),
  drafts: z.array(contextualTestListDraftSchema).max(TEST_LIST_PAGE_SIZE).optional(),
}).strict()
export function contextualTestListEnvelopeSchema<T extends z.ZodType>(data: T) {
  return z.object({ data: data.nullable(), error: z.null(), count: z.number().int().nonnegative().nullable().optional(),
    status: z.number().int().min(200).max(299).optional(), statusText: z.string().optional(),
  }).strict()
}

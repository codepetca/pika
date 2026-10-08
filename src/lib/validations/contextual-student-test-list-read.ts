import { z } from 'zod'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import { TEST_LIST_PAGE_SIZE, TEST_LIST_CHILD_PAGE_SIZE, contextualTestListClassroomSchema,
  contextualTestListEnrollmentSchema, contextualTestListEnvelopeSchema } from '@/lib/validations/contextual-test-list-read'

const uuid = z.string().uuid().refine(value => value === value.toLowerCase())
const inputUuid = z.string().uuid().transform(value => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)))
export const contextualStudentTestListQuerySchema = z.object({ classroomId: inputUuid }).strict()
export const contextualStudentTestListIdentitySchema = contextualStudentTestListQuerySchema.extend({ actorId: inputUuid }).strict()
export const contextualStudentTestListControlSchema = z.object({ id: uuid, classroom_id: uuid, status: z.enum(['active', 'closed']), updated_at: timestamp }).strict()
/** Exact legacy student list projection; no teacher-only Test columns. */
export const contextualStudentTestListTestSchema = contextualStudentTestListControlSchema.extend({
  title: z.string(), show_results: z.boolean(), documents: z.unknown().refine(value => boundedAssignmentListJson(value, 2 * 1024 * 1024)).pipe(z.json()),
  position: z.number().int(), points_possible: z.number().finite(), include_in_final: z.boolean(), gradebook_weight: z.number().finite(),
  created_by: uuid, created_at: timestamp,
}).strict()
const ownChild = z.object({ id: uuid, test_id: uuid, student_id: uuid }).strict()
export const contextualStudentTestListAttemptSchema = ownChild.extend({ is_submitted: z.boolean(), returned_at: timestamp.nullable(), closed_for_grading_at: timestamp.nullable() }).strict()
export const contextualStudentTestListResponseSchema = ownChild.extend({ selected_option: z.number().int().nonnegative().nullable(), response_text: z.string().nullable() }).strict()
export const contextualStudentTestListAvailabilitySchema = ownChild.extend({ state: z.enum(['open', 'closed']) }).strict()
export const contextualStudentTestListParentSchema = contextualStudentTestListControlSchema.extend({
  attempts: z.array(contextualStudentTestListAttemptSchema).max(TEST_LIST_CHILD_PAGE_SIZE).optional(),
  responses: z.array(contextualStudentTestListResponseSchema).max(TEST_LIST_CHILD_PAGE_SIZE).optional(),
  availability: z.array(contextualStudentTestListAvailabilitySchema).max(TEST_LIST_CHILD_PAGE_SIZE).optional(),
}).strict()
export const contextualStudentTestListRootSchema = contextualTestListClassroomSchema.extend({
  feature_visibility: z.unknown().refine(value => boundedAssignmentListJson(value, 4096)).pipe(z.json()),
  membership: z.array(contextualTestListEnrollmentSchema).length(1),
  tests: z.array(z.union([contextualStudentTestListTestSchema, contextualStudentTestListParentSchema])).max(TEST_LIST_PAGE_SIZE).optional(),
}).strict()
export const contextualStudentTestListEnvelopeSchema = contextualTestListEnvelopeSchema(contextualStudentTestListRootSchema)

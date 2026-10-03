import { z } from 'zod'
import { contextualCourseGuideReadTiptapSchema } from '@/lib/validations/contextual-course-guide-read'

export const ASSIGNMENT_LIST_PAGE_SIZE = 1000
export const ASSIGNMENT_LIST_BATCH_SIZE = 50
export const ASSIGNMENT_LIST_CHILD_PAGE_SIZE = 100
export const ASSIGNMENT_LIST_COLLECTION_LIMIT = 10000
export const ASSIGNMENT_LIST_STATEMENT_LIMIT = 1024
export const ASSIGNMENT_LIST_DEADLINE_MS = 20000
export const ASSIGNMENT_LIST_DTO_BYTES = 8 * 1024 * 1024
const uuid = z.string().uuid().refine(value => value === value.toLowerCase())
const inputUuid = z.string().uuid().transform(value => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)))
export const contextualAssignmentListQuerySchema = z.object({ classroomId: inputUuid }).strict()
export const contextualAssignmentListIdentitySchema = z.object({ actorId: inputUuid, classroomId: inputUuid }).strict()

/** Bound recursive decoding and byte size before Zod clones persisted JSON. */
export function boundedAssignmentListJson(value: unknown, bytes = ASSIGNMENT_LIST_DTO_BYTES): boolean {
  const stack = [{ value, depth: 0 }]; const seen = new Set<object>(); let nodes = 0
  while (stack.length) {
    const current = stack.pop()!
    if (++nodes > 500000 || current.depth > 100) return false
    if (current.value === null || typeof current.value === 'string' || typeof current.value === 'boolean') continue
    if (typeof current.value === 'number') { if (!Number.isFinite(current.value)) return false; continue }
    if (typeof current.value !== 'object' || seen.has(current.value)) return false
    seen.add(current.value)
    if (!Array.isArray(current.value) && Object.getPrototypeOf(current.value) !== Object.prototype) return false
    for (const child of Object.values(current.value)) stack.push({ value: child, depth: current.depth + 1 })
  }
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8') <= bytes } catch { return false }
}
const json = z.unknown().refine(value => boundedAssignmentListJson(value, 2 * 1024 * 1024)).pipe(z.json())
export const contextualAssignmentListClassroomSchema = z.object({ id: uuid, teacher_id: uuid, archived_at: timestamp.nullable() }).strict()
const enrollment = z.object({ classroom_id: uuid, student_id: uuid }).strict()
export const contextualAssignmentListAssignmentSchema = z.object({
  id: uuid, classroom_id: uuid, title: z.string(), description: z.string(), due_at: timestamp, position: z.number().int(),
  created_by: uuid, created_at: timestamp, updated_at: timestamp, is_draft: z.boolean(), released_at: timestamp.nullable(),
  instructions_markdown: z.string().nullable(), rich_instructions: contextualCourseGuideReadTiptapSchema.nullable(), artifact_id: uuid,
  source_artifact_id: uuid.nullable(), source_blueprint_version_id: uuid.nullable(), blueprint_archived_at: timestamp.nullable(),
  points_possible: z.number().finite(), gradebook_category_id: uuid.nullable(), gradebook_maximum_override: z.number().finite().nullable(),
  gradebook_score_scale: z.number().finite(), gradebook_weight: z.number().finite(), include_in_final: z.boolean(), track_authenticity: z.boolean(),
}).strict()
export const contextualAssignmentListRequirementSchema = z.object({
  id: uuid, assignment_id: uuid, artifact_id: uuid, type: z.enum(['repo_link', 'link', 'image']), label: z.string(), instructions: z.string(),
  required: z.boolean(), position: z.number().int(), created_at: timestamp, updated_at: timestamp,
  source_artifact_id: uuid.nullable(), source_blueprint_version_id: uuid.nullable(), validation_policy_json: json.pipe(z.record(z.string(), z.json())),
}).strict()
const docIdentity = z.object({ id: uuid, assignment_id: uuid, student_id: uuid }).strict()
export const contextualAssignmentListStatsDocSchema = docIdentity.extend({
  is_submitted: z.boolean(), submitted_at: timestamp.nullable(), returned_at: timestamp.nullable(), teacher_cleared_at: timestamp.nullable(),
  participant: z.object({ id: uuid, enrollment: z.array(enrollment).length(1) }).strict(),
}).strict()
export const contextualAssignmentListMemberDocSchema = docIdentity.extend({
  content: json, content_legacy: z.string(), is_submitted: z.boolean(), submitted_at: timestamp.nullable(),
  returned_at: timestamp.nullable(), feedback_returned_at: timestamp.nullable(), teacher_cleared_at: timestamp.nullable(),
  created_at: timestamp, updated_at: timestamp, viewed_at: timestamp.nullable(), github_username: z.string().nullable(), repo_url: z.string().nullable(),
  save_sequence: z.number().int().nullable(), save_session_id: uuid.nullable(),
}).strict()
export const contextualAssignmentListReturnedGradeSchema = docIdentity.extend({
  returned_at: timestamp, score_completion: z.number().finite().nullable(), score_thinking: z.number().finite().nullable(), score_workflow: z.number().finite().nullable(),
  graded_at: timestamp.nullable(), graded_by: uuid.nullable(),
}).strict()
export const contextualAssignmentListReleasedFeedbackSchema = docIdentity.extend({
  returned_at: timestamp.nullable(), feedback_returned_at: timestamp.nullable(), feedback: z.string().nullable(),
}).strict()
const parent = z.object({ id: uuid, classroom_id: uuid, is_draft: z.boolean(), released_at: timestamp.nullable() }).strict()
export const contextualAssignmentListPayloadSchema = contextualAssignmentListClassroomSchema.extend({
  feature_visibility: z.unknown().refine(value => boundedAssignmentListJson(value, 4096)).pipe(z.json()),
  membership: z.array(enrollment).length(1).optional(),
  enrollments: z.array(enrollment).max(ASSIGNMENT_LIST_PAGE_SIZE).optional(),
  assignments: z.array(z.union([
    contextualAssignmentListAssignmentSchema,
    parent.extend({ requirements: z.array(contextualAssignmentListRequirementSchema).max(ASSIGNMENT_LIST_PAGE_SIZE) }).strict(),
    parent.extend({ docs: z.array(contextualAssignmentListStatsDocSchema).max(ASSIGNMENT_LIST_PAGE_SIZE) }).strict(),
    parent.extend({ docs: z.array(contextualAssignmentListMemberDocSchema).max(ASSIGNMENT_LIST_PAGE_SIZE) }).strict(),
    parent.extend({ docs: z.array(contextualAssignmentListReturnedGradeSchema).max(ASSIGNMENT_LIST_PAGE_SIZE) }).strict(),
    parent.extend({ docs: z.array(contextualAssignmentListReleasedFeedbackSchema).max(ASSIGNMENT_LIST_PAGE_SIZE) }).strict(),
  ])).max(ASSIGNMENT_LIST_PAGE_SIZE).optional(),
}).strict()
function envelope<T extends z.ZodType>(data: T) {
  return z.unknown().refine(value => typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.hasOwn(value, 'data') && Object.hasOwn(value, 'error')).pipe(z.object({
      data: data.nullable(), error: z.null(), count: z.number().int().nonnegative().nullable().optional(),
      status: z.number().int().min(200).max(299).optional(), statusText: z.string().optional(),
    }).strict())
}
export const contextualAssignmentListClassroomEnvelopeSchema = envelope(contextualAssignmentListClassroomSchema)
export const contextualAssignmentListPayloadEnvelopeSchema = envelope(contextualAssignmentListPayloadSchema)

import { z } from 'zod'
import {
  boundedAssignmentListJson,
  contextualAssignmentListAssignmentSchema,
  contextualAssignmentListClassroomSchema,
  contextualAssignmentListRequirementSchema,
} from '@/lib/validations/contextual-assignment-list-read'

const uuid = z.string().uuid().refine(value => value === value.toLowerCase())
const inputUuid = z.string().uuid().transform(value => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)))
const json = z.unknown().refine(value => boundedAssignmentListJson(value, 2 * 1024 * 1024)).pipe(z.json())
export const contextualAssignmentOverviewQuerySchema = z.object({ assignmentId: inputUuid }).strict()
export const contextualAssignmentOverviewIdentitySchema = contextualAssignmentOverviewQuerySchema.extend({ actorId: inputUuid }).strict()
export const contextualAssignmentOverviewControlSchema = z.object({
  id: uuid, classroom_id: uuid, classrooms: contextualAssignmentListClassroomSchema,
}).strict()
export const contextualAssignmentOverviewAssignmentSchema = contextualAssignmentListAssignmentSchema.extend({
  classrooms: contextualAssignmentListClassroomSchema.extend({ title: z.string() }).strict(),
}).strict()
export const contextualAssignmentOverviewEnrollmentSchema = z.object({
  id: uuid, classroom_id: uuid, student_id: uuid,
  users: z.object({ id: uuid, email: z.string().email(), profiles: z.object({
    user_id: uuid, first_name: z.string().nullable(), last_name: z.string().nullable(),
  }).strict().nullable() }).strict(),
}).strict()
export const contextualAssignmentOverviewDocIdentitySchema = z.object({
  id: uuid, assignment_id: uuid, student_id: uuid,
  participant: z.object({ id: uuid, enrollment: z.array(z.object({ classroom_id: uuid, student_id: uuid }).strict()).length(1) }).strict(),
}).strict()
export const contextualAssignmentOverviewDocSchema = contextualAssignmentOverviewDocIdentitySchema.extend({
  content: json, is_submitted: z.boolean(), submitted_at: timestamp.nullable(), updated_at: timestamp,
  score_completion: z.number().finite().nullable(), score_thinking: z.number().finite().nullable(), score_workflow: z.number().finite().nullable(),
  graded_at: timestamp.nullable(), returned_at: timestamp.nullable(), teacher_cleared_at: timestamp.nullable(), feedback_returned_at: timestamp.nullable(),
}).strict()
export const contextualAssignmentOverviewHistorySchema = z.object({ id: uuid, assignment_doc_id: uuid, created_at: timestamp }).strict()
export const contextualAssignmentOverviewArtifactSchema = z.object({
  id: uuid, assignment_doc_id: uuid, requirement_id: uuid, student_id: uuid, type: z.enum(['repo_link', 'link', 'image']),
  url: z.string().nullable(), storage_path: z.string().nullable(), managed_object_id: uuid.nullable(), metadata_json: json.pipe(z.record(z.string(), z.json())),
  validation_status: z.enum(['missing', 'pending', 'valid', 'warning', 'invalid', 'inaccessible']), validation_message: z.string().nullable(),
  validated_at: timestamp.nullable(), created_at: timestamp, updated_at: timestamp,
  requirement: contextualAssignmentListRequirementSchema.pick({ id: true, assignment_id: true, type: true }).strict(),
  managed_object: z.object({ id: uuid, classroom_id: uuid, data_subject_user_id: uuid, resource_type: z.literal('assignment_doc'), resource_id: uuid,
    purpose: z.literal('student_assignment_artifact'), status: z.enum(['verified', 'ready']), storage_bucket: z.literal('assignment-artifacts'), storage_path: z.string(),
  }).strict().nullable(),
}).strict()
const count = z.number().int().nonnegative().max(10000)
export const contextualAssignmentOverviewRunSchema = z.object({
  id: uuid, assignment_id: uuid, status: z.enum(['queued', 'running']), model: z.string().nullable(), requested_count: count, gradable_count: count,
  processed_count: count, completed_count: count, skipped_missing_count: count, skipped_empty_count: count, failed_count: count,
  error_samples_json: z.array(z.object({ student_id: uuid.nullable(), code: z.string().nullable(), message: z.string() }).strict()).max(10000),
  started_at: timestamp.nullable(), completed_at: timestamp.nullable(), created_at: timestamp,
}).strict()
export const contextualAssignmentOverviewRunItemSchema = z.object({
  id: uuid, run_id: uuid, assignment_id: uuid, student_id: uuid,
  status: z.enum(['queued', 'processing', 'completed', 'skipped', 'failed']), next_retry_at: timestamp.nullable(),
}).strict()

/** The transport envelope and statement projection are exact, after the recursive size bound. */
export function contextualAssignmentOverviewEnvelopeSchema<T extends z.ZodType>(data: T) {
  return z.object({ data: data.nullable(), error: z.null(), count: z.number().int().nonnegative().nullable().optional(),
    status: z.number().int().min(200).max(299).optional(), statusText: z.string().optional(),
  }).strict()
}

import { z } from 'zod'
import { boundedAssignmentListJson, contextualAssignmentListAssignmentSchema, contextualAssignmentListRequirementSchema } from '@/lib/validations/contextual-assignment-list-read'
import { contextualAssignmentOverviewControlSchema, contextualAssignmentOverviewArtifactSchema } from '@/lib/validations/contextual-assignment-overview-read'

const uuid = z.string().uuid().refine(value => value === value.toLowerCase())
const inputUuid = z.string().uuid().transform(value => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)))
const number = z.number().finite()
const json = z.unknown().refine(value => boundedAssignmentListJson(value, 2 * 1024 * 1024)).pipe(z.json())
export const contextualAssignmentStudentDetailQuerySchema = z.object({ assignmentId: inputUuid, studentId: inputUuid }).strict()
export const contextualAssignmentStudentDetailIdentitySchema = contextualAssignmentStudentDetailQuerySchema.extend({ actorId: inputUuid }).strict()
export const contextualAssignmentStudentDetailEnrollmentSchema = z.object({ id: uuid, classroom_id: uuid, student_id: uuid }).strict()
export const contextualAssignmentStudentDetailControlSchema = contextualAssignmentOverviewControlSchema.extend({
  classrooms: contextualAssignmentOverviewControlSchema.shape.classrooms.extend({ target: z.array(contextualAssignmentStudentDetailEnrollmentSchema).length(1) }).strict(),
}).strict()
export const contextualAssignmentStudentDetailAssignmentSchema = contextualAssignmentListAssignmentSchema.pick({ id: true, classroom_id: true, title: true, description: true,
  due_at: true, position: true, created_by: true, created_at: true, updated_at: true, instructions_markdown: true, rich_instructions: true,
}).extend({ classrooms: contextualAssignmentStudentDetailControlSchema.shape.classrooms.extend({ title: z.string() }).strict() }).strict()
export const contextualAssignmentStudentDetailStudentSchema = contextualAssignmentStudentDetailControlSchema.extend({
  classrooms: contextualAssignmentStudentDetailControlSchema.shape.classrooms.extend({ target: z.array(contextualAssignmentStudentDetailEnrollmentSchema.extend({
    // The generated FK is one-to-one; PostgREST returns an object/null here.
    // Arrays (including duplicate singleton evidence) are rejected.
    users: z.object({ id: uuid, email: z.string().email(), profiles: z.object({ user_id: uuid, first_name: z.string().nullable(), last_name: z.string().nullable() }).strict().nullable() }).strict(),
  }).strict()).length(1) }).strict(),
}).strict()
export const contextualAssignmentStudentDetailDocIdentitySchema = z.object({ id: uuid, assignment_id: uuid, student_id: uuid }).strict()
/** Complete current assignment_docs Row: teacher-only fields are intentionally retained. */
export const contextualAssignmentStudentDetailDocSchema = contextualAssignmentStudentDetailDocIdentitySchema.extend({
  content: json, content_legacy: z.string(), is_submitted: z.boolean(), submitted_at: timestamp.nullable(), created_at: timestamp, updated_at: timestamp, viewed_at: timestamp.nullable(),
  save_sequence: z.number().int().nullable(), save_session_id: uuid.nullable(), repo_url: z.string().nullable(), github_username: z.string().nullable(),
  score_completion: number.nullable(), score_thinking: number.nullable(), score_workflow: number.nullable(), feedback: z.string().nullable(),
  teacher_feedback_draft: z.string().nullable(), teacher_feedback_draft_updated_at: timestamp.nullable(), feedback_returned_at: timestamp.nullable(),
  ai_feedback_suggestion: z.string().nullable(), ai_feedback_suggested_at: timestamp.nullable(), ai_feedback_model: z.string().nullable(), ai_grading_provenance: json.nullable(),
  ai_grading_review: json.nullable(), teacher_cleared_at: timestamp.nullable(), graded_at: timestamp.nullable(), graded_by: uuid.nullable(), returned_at: timestamp.nullable(),
  authenticity_score: number.nullable(), authenticity_flags: json.nullable(),
}).strict()
export const contextualAssignmentStudentDetailFeedbackSchema = z.object({
  id: uuid, assignment_id: uuid, student_id: uuid, entry_kind: z.enum(['teacher_feedback', 'grading_feedback']), author_type: z.enum(['teacher', 'ai']), body: z.string(),
  returned_at: timestamp, created_at: timestamp, created_by: uuid.nullable(),
}).strict()
export const contextualAssignmentStudentDetailTargetSchema = z.object({
  id: uuid, assignment_id: uuid, student_id: uuid, selected_repo_url: z.string().nullable(), override_github_username: z.string().nullable(), repo_owner: z.string().nullable(), repo_name: z.string().nullable(),
  selection_mode: z.enum(['auto', 'teacher_override']), validation_status: z.enum(['missing', 'ambiguous', 'valid', 'invalid', 'private', 'inaccessible']), validation_message: z.string().nullable(),
  validated_at: timestamp.nullable(), created_at: timestamp, updated_at: timestamp,
}).strict()
export const contextualAssignmentStudentDetailReviewSchema = z.object({
  id: uuid, run_id: uuid, assignment_id: uuid, student_id: uuid, github_login: z.string().nullable(), commit_count: number, active_days: number, session_count: number, burst_ratio: number,
  weighted_contribution: number, relative_contribution_share: number, spread_score: number, iteration_score: number, semantic_breakdown_json: json, timeline_json: json, evidence_json: json,
  draft_score_completion: number.nullable(), draft_score_thinking: number.nullable(), draft_score_workflow: number.nullable(), draft_feedback: z.string().nullable(), confidence: number,
  created_at: timestamp, grading_model: z.string().nullable(), grading_provenance: json.nullable(),
  run: z.object({ id: uuid, assignment_id: uuid, status: z.literal('completed') }).strict(),
}).strict()
export const contextualAssignmentStudentDetailRequirementSchema = contextualAssignmentListRequirementSchema
export const contextualAssignmentStudentDetailArtifactSchema = contextualAssignmentOverviewArtifactSchema

import { z } from 'zod'
import { saveStudentTestGradesSchema, clearTestOpenGradesSchema } from '@/lib/validations/test-grading'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const timestamp = z.iso.datetime({ offset: true })
export const ownerGradingParamsSchema = z.object({ id: uuid, studentId: uuid.optional(), responseId: uuid.optional() }).strict()
export const ownerReturnInputSchema = z.object({ student_ids: z.array(uuid).min(1).max(100).transform(ids => [...new Set(ids)]) }).strict()
export const ownerStudentGradesSchema = saveStudentTestGradesSchema.transform(value => ({ grades: value.grades.map(grade => ({
  ...grade, response_id: uuid.parse(grade.response_id), question_id: uuid.parse(grade.question_id),
})) })).refine(value => new Set(value.grades.map(grade => grade.response_id)).size === value.grades.length
  && new Set(value.grades.map(grade => grade.question_id)).size === value.grades.length, 'Duplicate grade identity')
export const ownerClearGradesSchema = clearTestOpenGradesSchema.pipe(z.object({
  student_ids: z.array(uuid).min(1).max(100).transform(ids => [...new Set(ids)]),
  responses: z.array(z.object({ response_id: uuid, expected_response_revision: count.positive() }).strict()).max(1000),
}).strict())
export const ownerSavedResponseSchema = z.object({ id: uuid, revision: count.positive(), score: z.number().nonnegative().nullable(), feedback: z.string().max(10000).nullable() }).strict()
// Transaction-only evidence for the inherited shape trigger's clear outcome.
// An unanswered closure MC cannot be cleared by the inherited atomic writer.
const clearContext = z.discriminatedUnion('question_type', [
  z.object({ response_id: uuid, question_id: uuid, question_type: z.literal('multiple_choice'), selected_option: count }).strict(),
  z.object({ response_id: uuid, question_id: uuid, question_type: z.literal('open_response'), selected_option: z.null() }).strict(),
])
export const ownerSaveResultSchema = z.object({ student_id: uuid.nullable(), saved_count: count, cleared_count: count,
  clear_context: z.array(clearContext).max(100), responses: z.array(ownerSavedResponseSchema).max(100) }).strict()
export const ownerClearResultSchema = z.object({ student_ids: z.array(uuid).max(100), cleared_students: count, skipped_students: count, cleared_responses: count }).strict()
export const ownerReturnResultSchema = z.object({ student_ids: z.array(uuid).max(100), returned_count: count, already_returned_count: count, skipped_count: count, test_closed: z.literal(false) }).strict()

// Source projections are deliberately stricter than database rows: no answer
// keys, provider payloads, provenance, review snapshots or credential fields.
export const ownerResultQuestionSchema = z.object({ id: uuid, test_id: uuid, question_type: z.enum(['multiple_choice', 'open_response']),
  question_text: z.string(), options: z.array(z.string()), correct_option: z.number().int().nullable(), points: z.number().nonnegative().max(9999.99),
  response_max_chars: count, response_monospace: z.boolean(), position: count, created_at: timestamp, updated_at: timestamp }).strict()
const response = z.object({ id: uuid, revision: count.positive(), test_id: uuid, question_id: uuid, student_id: uuid,
  selected_option: z.number().int().nullable(), response_text: z.string().nullable(), score: z.number().nonnegative().max(9999.99).nullable(), feedback: z.string().nullable(),
  graded_at: timestamp.nullable(), graded_by: uuid.nullable(), submitted_at: timestamp }).strict()
const attempt = z.object({ student_id: uuid, is_submitted: z.boolean(), submitted_at: timestamp.nullable(), returned_at: timestamp.nullable(),
  returned_by: uuid.nullable(), closed_for_grading_at: timestamp.nullable(), closed_for_grading_by: uuid.nullable(), updated_at: timestamp, responses: z.json() }).strict()
const focus = z.object({ student_id: uuid, event_type: z.enum(['away_start', 'away_end', 'route_exit_attempt', 'window_unmaximize_attempt']),
  session_id: z.string().nullable(), occurred_at: timestamp, metadata: z.record(z.string(), z.json()).nullable() }).strict()
export const ownerActiveRunSchema = z.object({ id: uuid, test_id: uuid, status: z.enum(['queued', 'running']), model: z.string().nullable(),
  prompt_guideline_override: z.string().nullable(), requested_count: count, eligible_student_count: count, queued_response_count: count,
  processed_count: count, completed_count: count, skipped_unanswered_count: count, skipped_already_graded_count: count, failed_count: count,
  pending_count: count, next_retry_at: timestamp.nullable(), error_samples: z.array(z.object({ student_id: uuid.nullable(), code: z.string().nullable(), message: z.string() }).strict()),
  started_at: timestamp.nullable(), completed_at: timestamp.nullable(), created_at: timestamp }).strict()
export const ownerResultsSourceSchema = z.object({
  questions: z.array(ownerResultQuestionSchema).max(500), student_ids: z.array(uuid).max(1000), responses: z.array(response).max(10000),
  attempts: z.array(attempt).max(1000), users: z.array(z.object({ id: uuid, email: z.string() }).strict()).max(1000),
  profiles: z.array(z.object({ user_id: uuid, first_name: z.string().nullable(), last_name: z.string().nullable() }).strict()).max(1000),
  focus_events: z.array(focus).max(10000), availability: z.array(z.object({ student_id: uuid, state: z.enum(['open', 'closed']) }).strict()).max(1000),
  active_ai_grading_run: ownerActiveRunSchema.nullable(),
}).strict()
export type OwnerResultsSource = z.infer<typeof ownerResultsSourceSchema>

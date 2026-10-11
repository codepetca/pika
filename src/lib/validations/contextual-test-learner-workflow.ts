import { z } from 'zod'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import { resolveContextualTestOwnerParams, readContextualTestOwnerBody } from '@/lib/validations/contextual-test-owner-workflow'
import { saveTestAttemptSchema, submitTestResponsesSchema } from '@/lib/validations/test-submissions'
import { postTestFocusEventSchema } from '@/lib/validations/test-focus-events'
import { ApiError } from '@/lib/api-error'
import { MAX_TEST_DOCUMENTS, validateTestDocumentsPayload } from '@/lib/test-documents'

export const TEST_LEARNER_DEADLINE_MS = 30000
export const TEST_LEARNER_REPLY_BYTES = 8 * 1024 * 1024
export const TEST_LEARNER_TOTAL_BYTES = 64 * 1024 * 1024
export const TEST_LEARNER_COLLECTION_LIMIT = 10000
export const TEST_LEARNER_RPC_LIMIT = 16
const uuid = z.string().uuid().transform(value => value.toLowerCase())
const stamp = z.string().datetime({ offset: true })
const nullableStamp = stamp.nullable()
const json = z.json()
export const testLearnerOperationSchema = z.enum(['inspect','detail','start','save','submit','recover','session','history','focus','results','document','history-plan','history-write'])
export type TestLearnerOperation = z.infer<typeof testLearnerOperationSchema>
export const testLearnerIdentitySchema = z.object({ actorId: uuid, testId: uuid }).strict()
export const testLearnerParamsSchema = z.object({ id: uuid, docId: uuid.optional() }).strict()
export const testLearnerHistoryQuerySchema = z.object({ requested_student_id: uuid.optional() }).strict()
export const testLearnerSavedAttemptSchema = z.object({ id: uuid, test_id: uuid, student_id: uuid, responses: z.record(z.string(), json),
  is_submitted: z.boolean(), submitted_at: nullableStamp, created_at: stamp, updated_at: stamp,
  draft_revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict()
const nullableAttempt = testLearnerSavedAttemptSchema.nullable()
const collection = <T extends z.ZodType>(schema: T) => z.array(schema).max(TEST_LEARNER_COLLECTION_LIMIT)
export const testLearnerQuestionSchema = z.object({ id: uuid, test_id: uuid,
  question_type: z.enum(['multiple_choice','open_response']), question_text: z.string(), options: z.array(z.string()).max(6),
  points: z.number().nullable(), response_max_chars: z.number().int().nullable(), response_monospace: z.boolean().nullable(),
  position: z.number().int(), created_at: stamp, updated_at: stamp }).strict()
const focusEvent = z.object({ event_type: z.enum(['away_start','away_end','route_exit_attempt','window_unmaximize_attempt']),
  session_id: z.string().nullable(), occurred_at: stamp, metadata: json.nullable() }).strict()
const lifecycle = z.object({ id: uuid, is_submitted: z.boolean(), returned_at: nullableStamp,
  closed_for_grading_at: nullableStamp, draft_revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict()
const documentCollection = z.array(json).max(MAX_TEST_DOCUMENTS).refine(value => validateTestDocumentsPayload(value).valid, 'Invalid Test document collection')
const test = z.object({ id: uuid, classroom_id: uuid, title: z.string(), status: z.enum(['draft','active','closed']),
  show_results: z.boolean(), documents: documentCollection, position: z.number().int(), created_at: stamp, updated_at: stamp }).strict()
export const testLearnerStateSchema = z.object({ test, attempt: lifecycle.nullable(), access_state: z.enum(['open','closed']).nullable(),
  has_submitted: z.boolean() }).strict()
const history = z.object({ id: uuid, test_attempt_id: uuid, patch: json.nullable(), snapshot: json.nullable(),
  word_count: z.number().int().nonnegative(), char_count: z.number().int().nonnegative(), paste_word_count: z.number().int().nonnegative().nullable(),
  keystroke_count: z.number().int().nonnegative().nullable(), trigger: z.enum(['autosave','blur','submit','baseline','teacher_close','teacher_unsubmit']), created_at: stamp }).strict()
export const testLearnerHistoryEntrySchema = history
const subject = { requested_student_id: uuid.optional() }
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const responses = z.record(z.string(), json).refine(value => Object.keys(value).length <= TEST_LEARNER_COLLECTION_LIMIT, 'Too many Test responses')
const metric = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const historyMetric = metric.max(2147483647)
const emptyPayload = z.object(subject).strict()
/** Exact application-owned operation arguments. They do not widen the generated
 * Database; the service boundary independently validates its received payload. */
export const testLearnerPayloadSchemas = {
  inspect: emptyPayload, detail: emptyPayload, start: emptyPayload, recover: emptyPayload,
  session: emptyPayload, history: emptyPayload, results: emptyPayload,
  save: z.object({ ...subject, responses, expected_revision: revision, trigger: z.enum(['autosave','blur']).optional(),
    paste_word_count: metric.optional(), keystroke_count: metric.optional() }).strict(),
  submit: z.object({ ...subject, responses, expected_revision: revision }).strict(),
  focus: z.object({ ...subject, session_id: z.string().min(1).max(120), event_type: focusEvent.shape.event_type,
    metadata: json.nullable().refine(value => boundedAssignmentListJson(value, 32768), 'Focus metadata exceeds budget') }).strict(),
  document: z.object({ ...subject, document_id: uuid, source: z.enum(['upload','link']) }).strict(),
  'history-plan': z.object({ ...subject, attempt_id: uuid, draft_revision: revision }).strict(),
  'history-write': z.object({ ...subject, attempt_id: uuid, draft_revision: revision, expected_last: history.nullable(),
    collapse: z.boolean(), patch: z.array(json).nullable(), snapshot: responses.nullable(), trigger: z.enum(['autosave','blur','baseline','submit']),
    word_count: historyMetric, char_count: historyMetric, paste_word_count: historyMetric, keystroke_count: historyMetric }).strict(),
} as const
const resultQuestion = z.object({ question_id: uuid, question_type: z.enum(['multiple_choice','open_response']), question_text: z.string(),
  options: z.array(z.string()).max(6), points: z.number(), response_max_chars: z.number().int(), response_monospace: z.boolean(),
  sample_solution: z.string().nullable(), correct_option: z.number().int().nullable(), selected_option: z.number().int().nullable(),
  response_text: z.string().nullable(), score: z.number().nullable(), feedback: z.string().nullable(), graded_at: nullableStamp, is_correct: z.boolean().nullable() }).strict()
const aggregate = z.object({ question_id: uuid, question_text: z.string(), options: z.array(z.string()).max(6),
  counts: z.array(z.number().int().nonnegative()).max(6), total_responses: z.number().int().nonnegative() }).strict()
const materialObject = z.object({ id: uuid, classroom_id: uuid, storage_path: z.string().min(1), status: z.literal('ready'),
  purpose: z.enum(['teacher_test_material','test_execution_snapshot']), content_type: z.string().nullable() }).strict()
const conflict = z.object({ conflict: z.literal(true), attempt: testLearnerSavedAttemptSchema }).strict()
export const testLearnerResultSchemas = {
  inspect: z.object({ access_mode: z.enum(['owner','member']) }).strict(),
  detail: z.object({ state: testLearnerStateSchema, attempt: nullableAttempt, questions: collection(testLearnerQuestionSchema),
    submitted_responses: z.record(uuid, z.object({ question_type: z.enum(['multiple_choice','open_response']), selected_option: z.number().int().optional(), response_text: z.string().optional() }).strict()),
    focus_events: collection(focusEvent) }).strict(),
  start: z.object({ questions: collection(testLearnerQuestionSchema), attempt: testLearnerSavedAttemptSchema }).strict(),
  save: z.union([conflict, z.object({ created: z.boolean(), previous_responses: z.record(z.string(), json), attempt: testLearnerSavedAttemptSchema }).strict()]),
  submit: z.union([conflict, z.object({ attempt_id: uuid, submitted_at: stamp, inserted_responses: z.number().int().nonnegative(),
    draft_revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict()]),
  recover: z.object({ attempt: nullableAttempt }).strict(),
  session: z.object({ state: testLearnerStateSchema }).strict(),
  history: z.object({ history: collection(history), attemptId: uuid.nullable() }).strict(),
  focus: z.object({ event_id: uuid, focus_events: collection(focusEvent) }).strict(),
  results: z.object({ state: testLearnerStateSchema, results: collection(aggregate), my_responses: z.record(uuid, z.number().int()),
    question_results: collection(resultQuestion), summary: z.object({ earned_points: z.number(), possible_points: z.number(), percent: z.number() }).strict() }).strict(),
  document: z.object({ document: json, content_type: z.string().nullable(), object: materialObject.nullable() }).strict(),
  'history-plan': z.object({ attempt: testLearnerSavedAttemptSchema, last_history: history.nullable() }).strict(),
  'history-write': z.object({ historyEntry: history.nullable() }).strict(),
} as const
export const testLearnerWitnessSchema = z.object({ version: z.literal(1), actor_id: uuid, classroom_id: uuid, test_id: uuid,
  subject_id: uuid, operation: testLearnerOperationSchema, result: json }).strict()

export { resolveContextualTestOwnerParams as resolveTestLearnerParams }
/** Reuse the existing finite2MiB body reader, with the same carried deadline. */
export async function readTestLearnerBody(request: Request, deadline: number) {
  return readContextualTestOwnerBody(request, deadline)
}
export function parseTestLearnerPayload(operation: TestLearnerOperation, body: unknown) {
  if (!boundedAssignmentListJson(body, 2 * 1024 * 1024)) throw new ApiError(400, 'Invalid test payload')
  if (operation === 'save') {
    const parsed = saveTestAttemptSchema.parse(body)
    if (!Number.isSafeInteger(parsed.pasteWordCount) || !Number.isSafeInteger(parsed.keystrokeCount)) throw new ApiError(400, 'Invalid test metrics')
    return testLearnerPayloadSchemas.save.parse({ responses: parsed.responses, expected_revision: parsed.expectedRevision, trigger: parsed.trigger ?? 'autosave',
      paste_word_count: parsed.pasteWordCount, keystroke_count: parsed.keystrokeCount })
  }
  if (operation === 'submit') {
    const parsed = submitTestResponsesSchema.parse(body)
    return testLearnerPayloadSchemas.submit.parse({ responses: parsed.responses, expected_revision: parsed.expectedRevision })
  }
  const parsed = postTestFocusEventSchema.parse(body)
  return testLearnerPayloadSchemas.focus.parse({ session_id: parsed.session_id, event_type: parsed.event_type, metadata: parsed.incident_id
    ? { ...(parsed.metadata ?? {}), detector_version: 2, incident_id: parsed.incident_id, client_event_id: parsed.client_event_id, client_occurred_at: parsed.client_occurred_at }
    : parsed.metadata ?? null })
}

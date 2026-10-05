import { z } from 'zod'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'

export const TEST_DRAFT_GET_QUESTION_LIMIT = 10000
export const TEST_DRAFT_GET_CONTENT_BYTES = 2 * 1024 * 1024
export const TEST_DRAFT_GET_ENVELOPE_BYTES = 8 * 1024 * 1024
export const TEST_DRAFT_GET_TOTAL_BYTES = 64 * 1024 * 1024
export const TEST_DRAFT_GET_DEADLINE_MS = 20000
const uuid = z.string().uuid().refine(value => value === value.toLowerCase())
const inputUuid = z.string().uuid().transform(value => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)))
const safeInteger = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)
const content = z.unknown().refine(value => boundedAssignmentListJson(value, TEST_DRAFT_GET_CONTENT_BYTES)).pipe(z.json())
export const contextualTestDraftGetQuerySchema = z.object({ testId: inputUuid }).strict()
export const contextualTestDraftGetIdentitySchema = contextualTestDraftGetQuerySchema.extend({ actorId: inputUuid }).strict()
export const contextualTestDraftGetRowSchema = z.object({
  id: uuid, assessment_type: z.literal('test'), assessment_id: uuid, classroom_id: uuid,
  content, version: safeInteger.positive(), created_by: uuid, updated_by: uuid, created_at: timestamp, updated_at: timestamp,
}).strict()
export const contextualTestDraftGetQuestionSchema = z.object({
  id: uuid, test_id: uuid, artifact_id: uuid, source_artifact_id: uuid.nullable(),
  question_type: z.enum(['multiple_choice', 'open_response']), question_text: z.string(), options: z.array(z.string()),
  correct_option: safeInteger.nullable(), answer_key: z.string().nullable(), sample_solution: z.string().nullable(),
  points: z.number().finite(), response_max_chars: safeInteger.positive(), response_monospace: z.boolean(), position: safeInteger,
}).strict()
export const contextualTestDraftGetSnapshotSchema = z.object({
  version: z.literal(1), actor_id: uuid,
  classroom: z.object({ id: uuid, teacher_id: uuid, archived_at: timestamp.nullable() }).strict(),
  test: z.object({ id: uuid, classroom_id: uuid, title: z.string(), show_results: z.boolean(),
    status: z.enum(['draft', 'active', 'closed']), blueprint_archived_at: timestamp.nullable(), questions_locked_at: timestamp.nullable(),
  }).strict(),
  draft: contextualTestDraftGetRowSchema.nullable(),
  question_count: safeInteger.nonnegative().max(TEST_DRAFT_GET_QUESTION_LIMIT),
  questions: z.array(contextualTestDraftGetQuestionSchema).max(TEST_DRAFT_GET_QUESTION_LIMIT),
  source_sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict()
export const contextualTestDraftGetFinalSchema = z.object({
  version: z.literal(1), actor_id: uuid, classroom_id: uuid, test_id: uuid,
  operation: z.enum(['inspect', 'create', 'repair']), draft: contextualTestDraftGetRowSchema,
  editingPolicy: z.object({ structureLocked: z.boolean() }).strict(),
}).strict()
export const contextualTestDraftGetRpcEnvelopeSchema = z.object({
  data: z.unknown(), error: z.object({ code: z.string(), message: z.string(), details: z.string().nullable().optional(), hint: z.string().nullable().optional() }).strict().nullable(),
  count: safeInteger.nonnegative().nullable().optional(), status: safeInteger.optional(), statusText: z.string().optional(),
}).strict().refine(value => Object.hasOwn(value, 'data') && Object.hasOwn(value, 'error'))

import { z } from 'zod'
import { createJsonPatch, shouldStoreSnapshot } from '@/lib/json-patch'
import { countCharacters, countWords } from '@/lib/tiptap-content'
import { assignmentSubmissionContentSchema } from '@/lib/validations/assignment-doc-submissions'
import type { AssignmentDoc, AssignmentDocHistoryEntry, TiptapContent } from '@/types'

type SupabaseLike = any

const timestampSchema = z.string().datetime({ offset: true })
const nullableTimestampSchema = timestampSchema.nullable()

const jsonPatchOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), path: z.string(), value: z.unknown() }).strict(),
  z.object({ op: z.literal('remove'), path: z.string() }).strict(),
  z.object({ op: z.literal('replace'), path: z.string(), value: z.unknown() }).strict(),
  z.object({ op: z.literal('move'), path: z.string(), from: z.string() }).strict(),
  z.object({ op: z.literal('copy'), path: z.string(), from: z.string() }).strict(),
  z.object({ op: z.literal('test'), path: z.string(), value: z.unknown() }).strict(),
])

const assignmentDocSchema = z.object({
  id: z.string().min(1),
  assignment_id: z.string().min(1),
  student_id: z.string().min(1),
  content: assignmentSubmissionContentSchema,
  content_legacy: z.string(),
  is_submitted: z.boolean(),
  submitted_at: nullableTimestampSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
  viewed_at: nullableTimestampSchema,
  score_completion: z.number().int().nullable(),
  score_thinking: z.number().int().nullable(),
  score_workflow: z.number().int().nullable(),
  feedback: z.string().nullable(),
  feedback_returned_at: nullableTimestampSchema,
  graded_at: nullableTimestampSchema,
  graded_by: z.string().nullable(),
  returned_at: nullableTimestampSchema,
  teacher_cleared_at: nullableTimestampSchema,
  teacher_feedback_draft: z.string().nullable(),
  teacher_feedback_draft_updated_at: nullableTimestampSchema,
  ai_feedback_suggestion: z.string().nullable(),
  ai_feedback_suggested_at: nullableTimestampSchema,
  ai_feedback_model: z.string().nullable(),
  authenticity_score: z.number().int().nullable(),
  authenticity_flags: z.array(z.object({
    timestamp: timestampSchema,
    wordDelta: z.number().int(),
    seconds: z.number().int().nonnegative(),
    wps: z.number().nonnegative(),
    reason: z.enum(['paste', 'high_wps']),
  }).strict()).nullable(),
  repo_url: z.string().nullable(),
  github_username: z.string().nullable(),
  save_session_id: z.string().uuid().nullable(),
  save_sequence: z.number().int().positive().nullable(),
}).strip()

const assignmentHistorySchema = z.object({
  id: z.string().min(1),
  assignment_doc_id: z.string().min(1),
  patch: z.array(jsonPatchOperationSchema).nullable(),
  snapshot: assignmentSubmissionContentSchema.nullable(),
  word_count: z.number().int().nonnegative(),
  char_count: z.number().int().nonnegative(),
  paste_word_count: z.number().int().nonnegative().nullable(),
  keystroke_count: z.number().int().nonnegative().nullable(),
  trigger: z.enum(['autosave', 'blur', 'submit', 'baseline', 'restore']),
  created_at: timestampSchema,
}).strip()

const atomicErrorSchema = z.object({
  ok: z.literal(false),
  status: z.union([z.literal(400), z.literal(403), z.literal(404), z.literal(409), z.literal(500)]),
  error_code: z.string(),
  error: z.string(),
}).strip()

const atomicSaveSuccessSchema = z.object({
  ok: z.literal(true),
  created: z.boolean(),
  doc: assignmentDocSchema,
  history_entry: assignmentHistorySchema.nullable(),
}).strip()

const atomicSubmitSuccessSchema = z.object({
  ok: z.literal(true),
  idempotent: z.boolean(),
  doc: assignmentDocSchema,
  history_entry: assignmentHistorySchema.nullable(),
}).strip()

const atomicUnsubmitSuccessSchema = z.object({
  ok: z.literal(true),
  doc: assignmentDocSchema,
}).strip()

type AssignmentDocMutationResult =
  | { ok: true; doc: AssignmentDoc; historyEntry: AssignmentDocHistoryEntry | null; idempotent?: boolean }
  | { ok: false; status: number; error: string; errorCode: string }

function invalidResult(error: z.ZodError): AssignmentDocMutationResult {
  console.error('Invalid assignment document atomic RPC result:', error)
  return { ok: false, status: 500, error: 'Assignment document operation failed', errorCode: 'invalid_rpc_result' }
}

function mapRpcError(error: any, operation: 'save' | 'submit' | 'unsubmit'): AssignmentDocMutationResult {
  if (error?.code === '23514' && error?.message?.includes('assignment_submission_requirements_incomplete')) {
    return {
      ok: false,
      status: 400,
      error: 'Complete the required submissions before submitting.',
      errorCode: 'assignment_submission_requirements_incomplete',
    }
  }
  if (error?.code === '42883' || error?.code === 'PGRST202') {
    return {
      ok: false,
      status: 500,
      error: 'Assignment submission migration is required',
      errorCode: 'assignment_submission_migration_required',
    }
  }
  console.error(`Error during atomic assignment document ${operation}:`, error)
  return {
    ok: false,
    status: 500,
    error: operation === 'save'
      ? 'Failed to save'
      : operation === 'submit'
        ? 'Failed to submit'
        : 'Failed to unsubmit',
    errorCode: `assignment_doc_${operation}_failed`,
  }
}

export async function unsubmitAssignmentDocAtomic(input: {
  supabase: SupabaseLike
  assignmentId: string
  studentId: string
}): Promise<AssignmentDocMutationResult> {
  const { data, error } = await input.supabase.rpc('unsubmit_assignment_doc_atomic', {
    p_assignment_id: input.assignmentId,
    p_student_id: input.studentId,
  })

  if (error) return mapRpcError(error, 'unsubmit')

  const rpcError = atomicErrorSchema.safeParse(data)
  if (rpcError.success) {
    return {
      ok: false,
      status: rpcError.data.status,
      error: rpcError.data.error,
      errorCode: rpcError.data.error_code,
    }
  }
  const parsed = atomicUnsubmitSuccessSchema.safeParse(data)
  if (!parsed.success) return invalidResult(parsed.error)
  return {
    ok: true,
    doc: parsed.data.doc as unknown as AssignmentDoc,
    historyEntry: null,
  }
}

export async function saveAssignmentDocAtomic(input: {
  supabase: SupabaseLike
  assignmentId: string
  studentId: string
  previousContent: TiptapContent
  content: TiptapContent
  expectedUpdatedAt: string | null
  trigger: 'autosave' | 'blur' | 'restore'
  pasteWordCount: number
  keystrokeCount: number
  saveSessionId: string
  saveSequence: number
  metricSessionId: string
}): Promise<AssignmentDocMutationResult> {
  const patch = createJsonPatch(input.previousContent, input.content)
  const snapshot = shouldStoreSnapshot(patch, input.content) ? input.content : null
  const { data, error } = await input.supabase.rpc('save_assignment_doc_atomic', {
    p_assignment_id: input.assignmentId,
    p_student_id: input.studentId,
    p_content: input.content,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_trigger: input.trigger,
    p_paste_word_count: input.pasteWordCount,
    p_keystroke_count: input.keystrokeCount,
    p_patch: patch,
    p_snapshot: snapshot,
    p_word_count: countWords(input.content),
    p_char_count: countCharacters(input.content),
    p_save_session_id: input.saveSessionId,
    p_save_sequence: input.saveSequence,
    p_metric_session_id: input.metricSessionId,
  })

  if (error) return mapRpcError(error, 'save')

  const rpcError = atomicErrorSchema.safeParse(data)
  if (rpcError.success) {
    return {
      ok: false,
      status: rpcError.data.status,
      error: rpcError.data.error,
      errorCode: rpcError.data.error_code,
    }
  }
  const parsed = atomicSaveSuccessSchema.safeParse(data)
  if (!parsed.success) return invalidResult(parsed.error)
  return {
    ok: true,
    doc: parsed.data.doc as unknown as AssignmentDoc,
    historyEntry: parsed.data.history_entry as AssignmentDocHistoryEntry | null,
  }
}

export async function submitAssignmentDocAtomic(input: {
  supabase: SupabaseLike
  assignmentId: string
  studentId: string
  content: TiptapContent
  expectedUpdatedAt: string
}): Promise<AssignmentDocMutationResult> {
  const { data, error } = await input.supabase.rpc('submit_assignment_doc_atomic', {
    p_assignment_id: input.assignmentId,
    p_student_id: input.studentId,
    p_content: input.content,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_word_count: countWords(input.content),
    p_char_count: countCharacters(input.content),
  })

  if (error) return mapRpcError(error, 'submit')

  const rpcError = atomicErrorSchema.safeParse(data)
  if (rpcError.success) {
    return {
      ok: false,
      status: rpcError.data.status,
      error: rpcError.data.error,
      errorCode: rpcError.data.error_code,
    }
  }
  const parsed = atomicSubmitSuccessSchema.safeParse(data)
  if (!parsed.success) return invalidResult(parsed.error)
  return {
    ok: true,
    doc: parsed.data.doc as unknown as AssignmentDoc,
    historyEntry: parsed.data.history_entry as AssignmentDocHistoryEntry | null,
    idempotent: parsed.data.idempotent,
  }
}

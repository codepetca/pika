import { z } from 'zod'

import { ApiError } from '@/lib/api-error'
import { createJsonPatch, shouldStoreSnapshot } from '@/lib/json-patch'
import { isRetryableDatabaseContention } from '@/lib/server/database-contention'
import {
  countCharacters,
  countWords,
} from '@/lib/tiptap-content'
import { assignmentSubmissionContentSchema } from '@/lib/validations/assignment-doc-submissions'
import type { AssignmentDoc, AssignmentDocHistoryEntry, TiptapContent } from '@/types'
import type { Json } from '@/types/database.generated'

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true })
const nullableTimestamp = timestamp.nullable()
const storedContent = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}, assignmentSubmissionContentSchema)
const jsonPatchOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), path: z.string(), value: z.unknown() }).strict(),
  z.object({ op: z.literal('remove'), path: z.string() }).strict(),
  z.object({ op: z.literal('replace'), path: z.string(), value: z.unknown() }).strict(),
  z.object({ op: z.literal('move'), path: z.string(), from: z.string() }).strict(),
  z.object({ op: z.literal('copy'), path: z.string(), from: z.string() }).strict(),
  z.object({ op: z.literal('test'), path: z.string(), value: z.unknown() }).strict(),
])
const assignmentDocSchema = z.object({
  id: canonicalUuid,
  assignment_id: canonicalUuid,
  student_id: canonicalUuid,
  content: assignmentSubmissionContentSchema,
  content_legacy: z.string(),
  is_submitted: z.boolean(),
  submitted_at: nullableTimestamp,
  created_at: timestamp,
  updated_at: timestamp,
  viewed_at: nullableTimestamp,
  score_completion: z.number().int().nullable(),
  score_thinking: z.number().int().nullable(),
  score_workflow: z.number().int().nullable(),
  feedback: z.string().nullable(),
  feedback_returned_at: nullableTimestamp,
  graded_at: nullableTimestamp,
  graded_by: z.string().nullable(),
  returned_at: nullableTimestamp,
  teacher_cleared_at: nullableTimestamp,
  teacher_feedback_draft: z.string().nullable(),
  teacher_feedback_draft_updated_at: nullableTimestamp,
  ai_feedback_suggestion: z.string().nullable(),
  ai_feedback_suggested_at: nullableTimestamp,
  ai_feedback_model: z.string().nullable(),
  authenticity_score: z.number().int().nullable(),
  authenticity_flags: z.array(z.object({
    timestamp,
    wordDelta: z.number().int(),
    seconds: z.number().int().nonnegative(),
    wps: z.number().nonnegative(),
    reason: z.enum(['paste', 'high_wps']),
  }).strict()).nullable(),
  repo_url: z.string().nullable(),
  github_username: z.string().nullable(),
  save_session_id: canonicalUuid.nullable(),
  save_sequence: z.number().int().positive().nullable(),
}).strip()
const assignmentHistorySchema = z.object({
  id: canonicalUuid,
  assignment_doc_id: canonicalUuid,
  patch: z.array(jsonPatchOperationSchema).nullable(),
  snapshot: assignmentSubmissionContentSchema.nullable(),
  word_count: z.number().int().nonnegative(),
  char_count: z.number().int().nonnegative(),
  paste_word_count: z.number().int().nonnegative().nullable(),
  keystroke_count: z.number().int().nonnegative().nullable(),
  trigger: z.enum(['autosave', 'blur', 'submit', 'baseline', 'restore']),
  created_at: timestamp,
}).strip()
const atomicErrorSchema = z.object({
  ok: z.literal(false),
  status: z.union([z.literal(400), z.literal(403), z.literal(404), z.literal(409), z.literal(500)]),
  error_code: z.string(),
  error: z.string(),
}).strip()
const saveSuccessSchema = z.object({
  ok: z.literal(true),
  created: z.boolean(),
  doc: assignmentDocSchema,
  history_entry: assignmentHistorySchema.nullable(),
}).strict()
const saveEvidenceSchema = z.array(z.object({
  id: canonicalUuid,
  assignment_id: canonicalUuid,
  student_id: canonicalUuid,
  is_submitted: z.boolean(),
  content: storedContent,
  updated_at: timestamp,
}).strict()).max(1)

export type ContextualAssignmentDocSaveClient = {
  rpc: (
    name: 'save_assignment_doc_for_member_v1',
    args: {
      p_actor_id: string
      p_assignment_id: string
      p_content: Json
      p_expected_updated_at: string | null
      p_trigger: string
      p_paste_word_count: number
      p_keystroke_count: number
      p_patch: Json
      p_snapshot: Json | null
      p_word_count: number
      p_char_count: number
      p_save_session_id: string
      p_save_sequence: number
      p_metric_session_id: string
    },
  ) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
}

export type ContextualAssignmentDocSaveResult =
  | { ok: true; doc: AssignmentDoc; historyEntry: AssignmentDocHistoryEntry | null }
  | { ok: false; status: number; error: string; errorCode: string }

export function verifyContextualAssignmentDocSaveEvidence(input: {
  actorId: string
  assignmentId: string
  rows: unknown
}) {
  const actorId = canonicalUuid.safeParse(input.actorId)
  const assignmentId = canonicalUuid.safeParse(input.assignmentId)
  const rows = saveEvidenceSchema.safeParse(input.rows)
  if (
    !actorId.success
    || !assignmentId.success
    || !rows.success
    || rows.data.some((row) => (
      row.assignment_id !== assignmentId.data || row.student_id !== actorId.data
    ))
  ) {
    throw new ApiError(503, 'Unable to verify assignment document')
  }
  return rows.data[0] ?? null
}

function mapRpcError(code: string | undefined): never {
  if (code === 'P0002') throw new ApiError(404, 'Assignment not found')
  if (code === '42501') throw new ApiError(403, 'Forbidden')
  if (code === '22023' || code === '22007' || code === '22008') {
    throw new ApiError(400, 'Invalid assignment save request')
  }
  if (isRetryableDatabaseContention({ code })) {
    throw new ApiError(409, 'Assignment access changed. Refresh and try again.')
  }
  throw new ApiError(503, 'Unable to save assignment')
}

/** Saves a matched classroom member's own document through the transaction boundary. */
export async function saveContextualAssignmentDoc(input: {
  supabase: ContextualAssignmentDocSaveClient
  actorId: string
  assignmentId: string
  previousContent: TiptapContent
  content: TiptapContent
  expectedUpdatedAt: string | null
  trigger: 'autosave' | 'blur' | 'restore'
  pasteWordCount: number
  keystrokeCount: number
  saveSessionId: string
  saveSequence: number
  metricSessionId: string
}): Promise<ContextualAssignmentDocSaveResult> {
  const actorId = canonicalUuid.safeParse(input.actorId)
  const assignmentId = canonicalUuid.safeParse(input.assignmentId)
  const saveSessionId = canonicalUuid.safeParse(input.saveSessionId)
  const metricSessionId = canonicalUuid.safeParse(input.metricSessionId)
  if (!actorId.success || !assignmentId.success || !saveSessionId.success || !metricSessionId.success) {
    throw new ApiError(400, 'Invalid assignment save request')
  }

  const patch = createJsonPatch(input.previousContent, input.content)
  const snapshot = shouldStoreSnapshot(patch, input.content) ? input.content : null
  const { data, error } = await input.supabase.rpc('save_assignment_doc_for_member_v1', {
    p_actor_id: actorId.data,
    p_assignment_id: assignmentId.data,
    p_content: input.content as unknown as Json,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_trigger: input.trigger,
    p_paste_word_count: input.pasteWordCount,
    p_keystroke_count: input.keystrokeCount,
    p_patch: patch as unknown as Json,
    p_snapshot: snapshot as unknown as Json | null,
    p_word_count: countWords(input.content),
    p_char_count: countCharacters(input.content),
    p_save_session_id: saveSessionId.data,
    p_save_sequence: input.saveSequence,
    p_metric_session_id: metricSessionId.data,
  })
  if (error) mapRpcError(error.code)

  const rpcError = atomicErrorSchema.safeParse(data)
  if (rpcError.success) {
    return {
      ok: false,
      status: rpcError.data.status,
      error: rpcError.data.error,
      errorCode: rpcError.data.error_code,
    }
  }

  const parsed = saveSuccessSchema.safeParse(data)
  if (
    !parsed.success
    || parsed.data.doc.assignment_id !== assignmentId.data
    || parsed.data.doc.student_id !== actorId.data
    || (
      parsed.data.history_entry !== null
      && parsed.data.history_entry.assignment_doc_id !== parsed.data.doc.id
    )
  ) {
    throw new ApiError(503, 'Unable to verify assignment save')
  }

  return {
    ok: true,
    doc: parsed.data.doc as unknown as AssignmentDoc,
    historyEntry: parsed.data.history_entry as unknown as AssignmentDocHistoryEntry | null,
  }
}

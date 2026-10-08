import { z } from 'zod'

import { ApiError } from '@/lib/api-error'
import { createJsonPatch, shouldStoreSnapshot } from '@/lib/json-patch'
import { isRetryableDatabaseContention } from '@/lib/server/database-contention'
import { countCharacters, countWords } from '@/lib/tiptap-content'
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
}).strict()
const assignmentDocSchema = z.object({
  id: canonicalUuid,
  assignment_id: canonicalUuid,
  student_id: canonicalUuid,
  content: storedContent,
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
  graded_by: canonicalUuid.nullable(),
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
const historyDocSchema = z.object({
  id: canonicalUuid,
  assignment_id: canonicalUuid,
  student_id: canonicalUuid,
  content: storedContent,
  is_submitted: z.boolean(),
  updated_at: timestamp,
}).strict()
const historyReadSchema = z.object({
  access_mode: z.enum(['owner', 'member']),
  assignment: z.object({
    id: canonicalUuid,
    classroom_id: canonicalUuid,
  }).strict(),
  subject_id: canonicalUuid,
  doc: historyDocSchema.nullable(),
  history: z.array(assignmentHistorySchema),
}).strict()
const atomicErrorSchema = z.object({
  ok: z.literal(false),
  status: z.union([z.literal(400), z.literal(403), z.literal(404), z.literal(409), z.literal(500)]),
  error_code: z.string(),
  error: z.string(),
  classroom_id: canonicalUuid,
}).strict()
const restoreSuccessSchema = z.object({
  ok: z.literal(true),
  created: z.boolean(),
  doc: assignmentDocSchema,
  history_entry: assignmentHistorySchema.nullable(),
  classroom_id: canonicalUuid,
}).strict()

export type ContextualAssignmentDocHistoryClient = {
  rpc(
    name: 'get_assignment_doc_history_for_actor_v1',
    args: {
      p_actor_id: string
      p_assignment_id: string
      p_requested_student_id?: string
      p_member_only?: boolean
    },
  ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
  rpc(
    name: 'restore_assignment_doc_for_member_v1',
    args: {
      p_actor_id: string
      p_assignment_id: string
      p_history_id: string
      p_content: Json
      p_expected_updated_at: string
      p_patch: Json
      p_snapshot: Json | null
      p_word_count: number
      p_char_count: number
      p_save_session_id: string
      p_save_sequence: number
      p_metric_session_id: string
    },
  ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
}

export type ContextualAssignmentDocHistoryRead = {
  accessMode: 'owner' | 'member'
  classroomId: string
  subjectId: string
  doc: z.infer<typeof historyDocSchema> | null
  history: AssignmentDocHistoryEntry[]
}

export type ContextualAssignmentDocRestoreResult =
  | { ok: true; doc: AssignmentDoc; historyEntry: AssignmentDocHistoryEntry | null; classroomId: string }
  | { ok: false; status: number; error: string; errorCode: string; classroomId?: string }

function mapRpcError(
  error: { code?: string; message?: string },
  operation: 'history' | 'restore',
): never {
  if (error.code === 'P0002') {
    throw new ApiError(404, operation === 'history' ? 'Assignment not found' : 'History entry not found')
  }
  if (error.code === '42501') throw new ApiError(403, 'Forbidden')
  if (error.code === '22023' || error.code === '22007' || error.code === '22008') {
    if (operation === 'history' && error.message?.includes('student_id is required')) {
      throw new ApiError(400, 'student_id is required')
    }
    throw new ApiError(400, `Invalid assignment ${operation} request`)
  }
  if (isRetryableDatabaseContention({ code: error.code })) {
    throw new ApiError(409, 'Assignment access changed. Refresh and try again.')
  }
  throw new ApiError(503, `Unable to ${operation === 'history' ? 'load assignment history' : 'restore assignment'}`)
}

export async function getContextualAssignmentDocHistory(input: {
  supabase: ContextualAssignmentDocHistoryClient
  actorId: string
  assignmentId: string
  requestedStudentId?: string | null
  memberOnly?: boolean
}): Promise<ContextualAssignmentDocHistoryRead> {
  const actorId = canonicalUuid.safeParse(input.actorId)
  const assignmentId = canonicalUuid.safeParse(input.assignmentId)
  const requestedStudentId = input.requestedStudentId == null
    ? { success: true as const, data: null }
    : canonicalUuid.safeParse(input.requestedStudentId)
  if (!actorId.success || !assignmentId.success || !requestedStudentId.success) {
    throw new ApiError(400, 'Invalid assignment history request')
  }

  const { data, error } = await input.supabase.rpc('get_assignment_doc_history_for_actor_v1', {
    p_actor_id: actorId.data,
    p_assignment_id: assignmentId.data,
    ...(requestedStudentId.data === null
      ? {}
      : { p_requested_student_id: requestedStudentId.data }),
    p_member_only: input.memberOnly ?? false,
  })
  if (error) mapRpcError(error, 'history')

  const parsed = historyReadSchema.safeParse(data)
  const expectedSubjectId = parsed.success && parsed.data.access_mode === 'owner'
    ? requestedStudentId.data
    : actorId.success ? actorId.data : null
  if (
    !parsed.success
    || parsed.data.assignment.id !== assignmentId.data
    || expectedSubjectId === null
    || parsed.data.subject_id !== expectedSubjectId
    || (input.memberOnly === true && parsed.data.access_mode !== 'member')
    || parsed.data.doc?.assignment_id !== assignmentId.data
    || parsed.data.doc?.student_id !== parsed.data.subject_id
    || (parsed.data.doc === null && parsed.data.history.length > 0)
    || parsed.data.history.some((entry) => entry.assignment_doc_id !== parsed.data.doc?.id)
  ) {
    throw new ApiError(503, 'Unable to verify assignment history')
  }

  return {
    accessMode: parsed.data.access_mode,
    classroomId: parsed.data.assignment.classroom_id,
    subjectId: parsed.data.subject_id,
    doc: parsed.data.doc,
    history: parsed.data.history as unknown as AssignmentDocHistoryEntry[],
  }
}

export async function restoreContextualAssignmentDoc(input: {
  supabase: ContextualAssignmentDocHistoryClient
  actorId: string
  assignmentId: string
  historyId: string
  previousContent: TiptapContent
  content: TiptapContent
  expectedUpdatedAt: string
  saveSessionId: string
  saveSequence: number
  metricSessionId: string
}): Promise<ContextualAssignmentDocRestoreResult> {
  const actorId = canonicalUuid.safeParse(input.actorId)
  const assignmentId = canonicalUuid.safeParse(input.assignmentId)
  const historyId = canonicalUuid.safeParse(input.historyId)
  const expectedUpdatedAt = timestamp.safeParse(input.expectedUpdatedAt)
  const saveSessionId = canonicalUuid.safeParse(input.saveSessionId)
  const metricSessionId = canonicalUuid.safeParse(input.metricSessionId)
  if (
    !actorId.success
    || !assignmentId.success
    || !historyId.success
    || !expectedUpdatedAt.success
    || !saveSessionId.success
    || !metricSessionId.success
    || !Number.isSafeInteger(input.saveSequence)
    || input.saveSequence <= 0
  ) {
    throw new ApiError(400, 'Invalid assignment restore request')
  }

  const patch = createJsonPatch(input.previousContent, input.content)
  const snapshot = shouldStoreSnapshot(patch, input.content) ? input.content : null
  const { data, error } = await input.supabase.rpc('restore_assignment_doc_for_member_v1', {
    p_actor_id: actorId.data,
    p_assignment_id: assignmentId.data,
    p_history_id: historyId.data,
    p_content: input.content as unknown as Json,
    p_expected_updated_at: expectedUpdatedAt.data,
    p_patch: patch as unknown as Json,
    p_snapshot: snapshot as unknown as Json | null,
    p_word_count: countWords(input.content),
    p_char_count: countCharacters(input.content),
    p_save_session_id: saveSessionId.data,
    p_save_sequence: input.saveSequence,
    p_metric_session_id: metricSessionId.data,
  })
  if (error) mapRpcError(error, 'restore')

  const rpcError = atomicErrorSchema.safeParse(data)
  if (rpcError.success) {
    return {
      ok: false,
      status: rpcError.data.status,
      error: rpcError.data.error,
      errorCode: rpcError.data.error_code,
      classroomId: rpcError.data.classroom_id,
    }
  }

  const parsed = restoreSuccessSchema.safeParse(data)
  if (
    !parsed.success
    || parsed.data.doc.assignment_id !== assignmentId.data
    || parsed.data.doc.student_id !== actorId.data
    || (
      parsed.data.history_entry !== null
      && parsed.data.history_entry.assignment_doc_id !== parsed.data.doc.id
    )
  ) {
    throw new ApiError(503, 'Unable to verify assignment restore')
  }

  return {
    ok: true,
    doc: parsed.data.doc as unknown as AssignmentDoc,
    historyEntry: parsed.data.history_entry as unknown as AssignmentDocHistoryEntry | null,
    classroomId: parsed.data.classroom_id,
  }
}

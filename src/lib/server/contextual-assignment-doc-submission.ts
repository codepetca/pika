import { z } from 'zod'

import { ApiError } from '@/lib/api-error'
import { countCharacters, countWords } from '@/lib/tiptap-content'
import { isRetryableDatabaseContention } from '@/lib/server/database-contention'
import { assignmentSubmissionContentSchema } from '@/lib/validations/assignment-doc-submissions'
import type {
  AssignmentDoc,
  AssignmentDocHistoryEntry,
  AssignmentSubmissionArtifact,
  AssignmentSubmissionRequirement,
  TiptapContent,
} from '@/types'
import type { Json } from '@/types/database.generated'
import type { v1 } from '@/vendor/pal-contract'

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
  classroom_id: canonicalUuid,
}).strict()
const submitSuccessSchema = z.object({
  ok: z.literal(true),
  idempotent: z.boolean(),
  doc: assignmentDocSchema,
  history_entry: assignmentHistorySchema.nullable(),
  classroom_id: canonicalUuid,
}).strict()
const unsubmitSuccessSchema = z.object({
  ok: z.literal(true),
  doc: assignmentDocSchema,
  classroom_id: canonicalUuid,
}).strict()
const assignmentEvidenceSchema = z.array(z.object({
  id: canonicalUuid,
  classroom_id: canonicalUuid,
  due_at: nullableTimestamp,
}).strict()).max(1)
const docEvidenceSchema = z.array(z.object({
  id: canonicalUuid,
  assignment_id: canonicalUuid,
  student_id: canonicalUuid,
  content: storedContent,
  is_submitted: z.boolean(),
  submitted_at: nullableTimestamp,
  updated_at: timestamp,
  returned_at: nullableTimestamp,
  teacher_cleared_at: nullableTimestamp,
}).strict()).max(1)
const requirementEvidenceSchema = z.array(z.object({
  id: canonicalUuid,
  assignment_id: canonicalUuid,
}).passthrough()).max(1000)
const artifactEvidenceSchema = z.array(z.object({
  id: canonicalUuid,
  assignment_doc_id: canonicalUuid,
  requirement_id: canonicalUuid,
}).passthrough()).max(1000)

export type ContextualAssignmentSubmissionClient = {
  rpc: (
    name: 'submit_assignment_doc_for_member_v1' | 'unsubmit_assignment_doc_for_member_v1',
    args: Record<string, Json | string | number | boolean | null | string[]>,
  ) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
}

export type ContextualAssignmentSubmissionResult =
  | {
      ok: true
      doc: AssignmentDoc
      historyEntry: AssignmentDocHistoryEntry | null
      classroomId: string
      idempotent?: boolean
    }
  | { ok: false; status: number; error: string; errorCode: string; classroomId: string }

export function verifyContextualAssignmentSubmissionAssignmentEvidence(input: {
  assignmentId: string
  rows: unknown
}) {
  const assignmentId = canonicalUuid.safeParse(input.assignmentId)
  const rows = assignmentEvidenceSchema.safeParse(input.rows)
  if (
    !assignmentId.success
    || !rows.success
    || rows.data.some((row) => row.id !== assignmentId.data)
  ) {
    throw new ApiError(503, 'Unable to verify assignment submission')
  }
  return rows.data[0] ?? null
}

export function verifyContextualAssignmentSubmissionDocEvidence(input: {
  actorId: string
  assignmentId: string
  rows: unknown
}) {
  const actorId = canonicalUuid.safeParse(input.actorId)
  const assignmentId = canonicalUuid.safeParse(input.assignmentId)
  const rows = docEvidenceSchema.safeParse(input.rows)
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

export function assertContextualAssignmentSubmissionResourceEvidence(input: {
  assignmentId: string
  assignmentDocId: string
  requirements: AssignmentSubmissionRequirement[]
  artifacts: AssignmentSubmissionArtifact[]
}): void {
  const assignmentId = canonicalUuid.safeParse(input.assignmentId)
  const assignmentDocId = canonicalUuid.safeParse(input.assignmentDocId)
  const requirements = requirementEvidenceSchema.safeParse(input.requirements)
  const artifacts = artifactEvidenceSchema.safeParse(input.artifacts)
  const requirementIds = requirements.success
    ? new Set(requirements.data.map((requirement) => requirement.id))
    : new Set<string>()
  if (
    !assignmentId.success
    || !assignmentDocId.success
    || !requirements.success
    || !artifacts.success
    || requirements.data.some((requirement) => requirement.assignment_id !== assignmentId.data)
    || artifacts.data.some((artifact) => (
      artifact.assignment_doc_id !== assignmentDocId.data
      || !requirementIds.has(artifact.requirement_id)
    ))
  ) {
    throw new ApiError(503, 'Unable to verify assignment submission resources')
  }
}

function mapRpcError(code: string | undefined, operation: 'submit' | 'unsubmit'): never {
  if (code === 'P0002') throw new ApiError(404, 'Assignment not found')
  if (code === '42501') throw new ApiError(403, 'Forbidden')
  if (code === '22023' || code === '22007' || code === '22008') {
    throw new ApiError(400, `Invalid assignment ${operation} request`)
  }
  if (isRetryableDatabaseContention({ code })) {
    throw new ApiError(409, 'Assignment access changed. Refresh and try again.')
  }
  throw new ApiError(503, `Unable to ${operation} assignment`)
}

function parseStructuredError(data: unknown): ContextualAssignmentSubmissionResult | null {
  const parsed = atomicErrorSchema.safeParse(data)
  if (!parsed.success) return null
  return {
    ok: false,
    status: parsed.data.status,
    error: parsed.data.error,
    errorCode: parsed.data.error_code,
    classroomId: parsed.data.classroom_id,
  }
}

export async function submitContextualAssignmentDoc(input: {
  supabase: ContextualAssignmentSubmissionClient
  actorId: string
  assignmentId: string
  content: TiptapContent
  expectedUpdatedAt: string
  acknowledgedMissingRequirementIds?: string[]
  palEvent?: v1.LearningItemCompletedEvent | null
}): Promise<ContextualAssignmentSubmissionResult> {
  const actorId = canonicalUuid.safeParse(input.actorId)
  const assignmentId = canonicalUuid.safeParse(input.assignmentId)
  const expectedUpdatedAt = timestamp.safeParse(input.expectedUpdatedAt)
  const acknowledgedIds = z.array(canonicalUuid).max(1000).safeParse(
    input.acknowledgedMissingRequirementIds ?? [],
  )
  if (!actorId.success || !assignmentId.success || !expectedUpdatedAt.success || !acknowledgedIds.success) {
    throw new ApiError(400, 'Invalid assignment submit request')
  }

  const emitPalEvent = input.palEvent !== undefined
  const { data, error } = await input.supabase.rpc('submit_assignment_doc_for_member_v1', {
    p_actor_id: actorId.data,
    p_assignment_id: assignmentId.data,
    p_content: input.content as unknown as Json,
    p_expected_updated_at: expectedUpdatedAt.data,
    p_word_count: countWords(input.content),
    p_char_count: countCharacters(input.content),
    p_acknowledged_missing_requirement_ids: acknowledgedIds.data,
    p_emit_pal_event: emitPalEvent,
    p_pal_event: (input.palEvent ?? null) as unknown as Json | null,
  })
  if (error) mapRpcError(error.code, 'submit')

  const structuredError = parseStructuredError(data)
  if (structuredError) return structuredError

  const parsed = submitSuccessSchema.safeParse(data)
  if (
    !parsed.success
    || parsed.data.doc.assignment_id !== assignmentId.data
    || parsed.data.doc.student_id !== actorId.data
    || (
      parsed.data.history_entry !== null
      && parsed.data.history_entry.assignment_doc_id !== parsed.data.doc.id
    )
  ) {
    throw new ApiError(503, 'Unable to verify assignment submission')
  }

  return {
    ok: true,
    doc: parsed.data.doc as unknown as AssignmentDoc,
    historyEntry: parsed.data.history_entry as unknown as AssignmentDocHistoryEntry | null,
    classroomId: parsed.data.classroom_id,
    idempotent: parsed.data.idempotent,
  }
}

export async function unsubmitContextualAssignmentDoc(input: {
  supabase: ContextualAssignmentSubmissionClient
  actorId: string
  assignmentId: string
}): Promise<ContextualAssignmentSubmissionResult> {
  const actorId = canonicalUuid.safeParse(input.actorId)
  const assignmentId = canonicalUuid.safeParse(input.assignmentId)
  if (!actorId.success || !assignmentId.success) {
    throw new ApiError(400, 'Invalid assignment unsubmit request')
  }

  const { data, error } = await input.supabase.rpc('unsubmit_assignment_doc_for_member_v1', {
    p_actor_id: actorId.data,
    p_assignment_id: assignmentId.data,
  })
  if (error) mapRpcError(error.code, 'unsubmit')

  const structuredError = parseStructuredError(data)
  if (structuredError) return structuredError

  const parsed = unsubmitSuccessSchema.safeParse(data)
  if (
    !parsed.success
    || parsed.data.doc.assignment_id !== assignmentId.data
    || parsed.data.doc.student_id !== actorId.data
  ) {
    throw new ApiError(503, 'Unable to verify assignment unsubmit')
  }

  return {
    ok: true,
    doc: parsed.data.doc as unknown as AssignmentDoc,
    historyEntry: null,
    classroomId: parsed.data.classroom_id,
  }
}

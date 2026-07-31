import { z } from 'zod'
import { createJsonPatch, shouldStoreSnapshot } from '@/lib/json-patch'
import { countCharacters, countWords } from '@/lib/tiptap-content'
import { assignmentSubmissionContentSchema } from '@/lib/validations/assignment-doc-submissions'
import type { AssignmentDoc, AssignmentDocHistoryEntry, TiptapContent } from '@/types'
import type { v1 } from '@/vendor/pal-contract'

type SupabaseLike = any

type ManagedStorageReference = {
  bucket: string
  path: string
  managedObjectId?: string
}

type ManagedStorageClaim = {
  managed_object_id: string
  storage_bucket: string
  storage_path: string
}

type ParsedStorageReference =
  | { kind: 'external' }
  | { kind: 'invalid' }
  | { kind: 'managed'; reference: ManagedStorageReference }

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

function parseCurrentPikaStorageReference(value: unknown): ParsedStorageReference {
  if (typeof value !== 'string') return { kind: 'external' }
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  if (!configuredUrl) return { kind: 'external' }

  let candidate: URL
  let configured: URL
  try {
    candidate = new URL(value)
    configured = new URL(configuredUrl)
  } catch {
    return { kind: 'external' }
  }
  if (candidate.origin !== configured.origin) return { kind: 'external' }
  if (!candidate.pathname.startsWith('/storage/v1/object/')) return { kind: 'external' }
  const match = candidate.pathname.match(
    /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/,
  )
  if (!match) return { kind: 'invalid' }

  let bucket: string
  let path: string
  try {
    bucket = decodeURIComponent(match[1])
    path = decodeURIComponent(match[2])
  } catch {
    return { kind: 'invalid' }
  }
  if (
    !bucket
    || bucket.includes('/')
    || !path
    || path.startsWith('/')
    || path.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    return { kind: 'invalid' }
  }
  return { kind: 'managed', reference: { bucket, path } }
}

function collectAssignmentDocManagedStorageReferences(
  content: TiptapContent,
): { references: ManagedStorageReference[]; hasInvalidReference: boolean } {
  const references = new Map<string, ManagedStorageReference>()
  let hasInvalidReference = false
  const inspectAttributes = (attributes: unknown) => {
    if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return
    const record = attributes as Record<string, unknown>
    const hasManagedObjectId = Object.hasOwn(record, 'managed_object_id')
    const parsedManagedObjectId = hasManagedObjectId
      ? z.string().uuid().safeParse(record.managed_object_id)
      : null
    if (parsedManagedObjectId && !parsedManagedObjectId.success) {
      hasInvalidReference = true
      return
    }
    let managedReferenceCount = 0
    for (const [key, value] of Object.entries(record)) {
      if (key === 'managed_object_id') continue
      const parsed = parseCurrentPikaStorageReference(value)
      if (parsed.kind === 'invalid') hasInvalidReference = true
      if (parsed.kind === 'managed') {
        managedReferenceCount += 1
        const reference = {
          ...parsed.reference,
          ...(parsedManagedObjectId?.success
            ? { managedObjectId: parsedManagedObjectId.data.toLowerCase() }
            : {}),
        }
        const referenceKey = `${reference.bucket}\0${reference.path}`
        const current = references.get(referenceKey)
        if (
          current?.managedObjectId
          && reference.managedObjectId
          && current.managedObjectId !== reference.managedObjectId
        ) {
          hasInvalidReference = true
        } else {
          references.set(referenceKey, current?.managedObjectId ? current : reference)
        }
      }
    }
    if (hasManagedObjectId && managedReferenceCount === 0) hasInvalidReference = true
  }
  const stack = [...(content.content ?? [])]
  while (stack.length > 0) {
    const node = stack.pop()!
    inspectAttributes(node.attrs)
    for (const mark of node.marks ?? []) inspectAttributes(mark.attrs)
    stack.push(...(node.content ?? []))
  }
  return { references: [...references.values()], hasInvalidReference }
}

async function validateAssignmentDocManagedStorageOwnership(input: {
  supabase: SupabaseLike
  assignmentId: string
  content: TiptapContent
}): Promise<
  | { ok: true; claims: ManagedStorageClaim[] }
  | { ok: false; result: AssignmentDocMutationResult }
> {
  const { references, hasInvalidReference } = collectAssignmentDocManagedStorageReferences(
    input.content,
  )
  if (hasInvalidReference) {
    return { ok: false, result: {
      ok: false, status: 400,
      error: 'This document contains an invalid Pika file reference.',
      errorCode: 'assignment_doc_managed_storage_reference_invalid',
    } }
  }
  if (references.length === 0) return { ok: true, claims: [] }

  const { data: assignment, error: assignmentError } = await input.supabase
    .from('assignments')
    .select('classroom_id')
    .eq('id', input.assignmentId)
    .maybeSingle()
  if (assignmentError) {
    console.error('Failed to validate assignment document file ownership:', assignmentError)
    return { ok: false, result: {
      ok: false, status: 500,
      error: 'Failed to validate files in this assignment document.',
      errorCode: 'assignment_doc_managed_storage_validation_failed',
    } }
  }
  if (!assignment) {
    return { ok: false, result: {
      ok: false, status: 404,
      error: 'Assignment not found.',
      errorCode: 'assignment_not_found',
    } }
  }

  const claims: ManagedStorageClaim[] = []
  for (const reference of references) {
    let objectQuery = input.supabase
      .from('managed_storage_objects')
      .select('id, classroom_id, status')
      .eq('storage_bucket', reference.bucket)
      .eq('storage_path', reference.path)
    if (reference.managedObjectId) {
      objectQuery = objectQuery.eq('id', reference.managedObjectId)
    }
    const { data: object, error: objectError } = await objectQuery.maybeSingle()
    if (objectError) {
      console.error('Failed to validate assignment document file ownership:', objectError)
      return { ok: false, result: {
        ok: false, status: 500,
        error: 'Failed to validate files in this assignment document.',
        errorCode: 'assignment_doc_managed_storage_validation_failed',
      } }
    }
    if (
      (reference.managedObjectId && object?.id !== reference.managedObjectId)
      || object?.classroom_id !== assignment.classroom_id
      || object.status !== 'ready'
    ) {
      return { ok: false, result: {
        ok: false, status: 400,
        error: 'This document contains a Pika file that does not belong to this classroom.',
        errorCode: 'assignment_doc_managed_storage_owner_mismatch',
      } }
    }
    claims.push({
      managed_object_id: object.id,
      storage_bucket: reference.bucket,
      storage_path: reference.path,
    })
  }
  return { ok: true, claims }
}

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
  const ownership = await validateAssignmentDocManagedStorageOwnership(input)
  if (!ownership.ok) return ownership.result

  const patch = createJsonPatch(input.previousContent, input.content)
  const snapshot = shouldStoreSnapshot(patch, input.content) ? input.content : null
  const { data, error } = await input.supabase.rpc('save_assignment_doc_managed_atomic', {
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
    p_managed_storage_claims: ownership.claims,
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
  palEvent?: v1.LearningItemCompletedEvent | null
}): Promise<AssignmentDocMutationResult> {
  const ownership = await validateAssignmentDocManagedStorageOwnership(input)
  if (!ownership.ok) return ownership.result

  const usePalOutbox = input.palEvent !== undefined
  const { data, error } = await input.supabase.rpc(
    usePalOutbox
      ? 'submit_assignment_doc_with_pal_event_managed_atomic'
      : 'submit_assignment_doc_managed_atomic',
    {
      p_assignment_id: input.assignmentId,
      p_student_id: input.studentId,
      p_content: input.content,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_word_count: countWords(input.content),
      p_char_count: countCharacters(input.content),
      p_managed_storage_claims: ownership.claims,
      ...(usePalOutbox ? { p_pal_event: input.palEvent } : {}),
    },
  )

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

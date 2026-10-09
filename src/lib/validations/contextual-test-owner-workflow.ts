import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import { contextualTestListTestSchema } from '@/lib/validations/contextual-test-list-read'
import { contextualTestDraftGetRpcEnvelopeSchema } from '@/lib/validations/contextual-test-draft-get'
import { isAllowedTestDocumentType, TEST_DOCUMENT_MAX_SIZE, validateTestDocumentsPayload } from '@/lib/test-documents'

export const TEST_OWNER_WORKFLOW_DEADLINE_MS = 30000
export const TEST_OWNER_WORKFLOW_BODY_BYTES = 2 * 1024 * 1024
export const TEST_OWNER_WORKFLOW_ROW_BYTES = 4 * 1024 * 1024
const inputUuid = z.string().uuid().transform(value => value.toLowerCase())
export const contextualTestOwnerIdentitySchema = z.object({ actorId: inputUuid, testId: inputUuid }).strict()
export const contextualTestOwnerQuerySchema = z.object({ testId: inputUuid }).strict()
export const contextualTestOwnerDocumentQuerySchema = contextualTestOwnerQuerySchema.extend({ documentId: inputUuid }).strict()
const documents = z.unknown().transform((value, ctx) => {
  const validated = validateTestDocumentsPayload(value)
  if (!validated.valid) { ctx.addIssue({ code: 'custom', message: validated.error }); return z.NEVER }
  if (new Set(validated.documents.map(doc => doc.id)).size !== validated.documents.length) {
    ctx.addIssue({ code: 'custom', message: 'Document IDs must be unique' }); return z.NEVER
  }
  return validated.documents
})
export const contextualTestOwnerMetadataSchema = z.object({
  title: z.string().trim().min(1).max(10000).optional(), show_results: z.boolean().optional(), documents: documents.optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'No updates provided')
export const contextualTestOwnerStudentAccessSchema = z.object({
  state: z.enum(['open', 'closed']), student_ids: z.array(inputUuid).min(1).max(100).transform(ids => [...new Set(ids)]),
}).strict()
export const contextualTestOwnerReservationSchema = z.object({
  document_id: inputUuid, file_name: z.string().trim().min(1).max(255),
  content_type: z.string().trim().min(1).refine(isAllowedTestDocumentType), byte_size: z.number().int().positive().max(TEST_DOCUMENT_MAX_SIZE),
}).strict()
export const contextualTestOwnerFinalizationSchema = z.object({ document_id: inputUuid, managed_object_id: inputUuid }).strict()
export const contextualTestOwnerCancellationSchema = z.object({ managed_object_id: inputUuid }).strict()
export const contextualTestOwnerOperationSchema = z.enum(['inspect', 'update', 'student-access', 'reserve', 'upload', 'verify', 'cancel', 'sync', 'document'])
export type TestOwnerOperation = z.infer<typeof contextualTestOwnerOperationSchema>
export const contextualTestOwnerWitnessSchema = z.object({
  version: z.literal(1), actor_id: inputUuid, classroom_id: inputUuid, test_id: inputUuid,
  operation: contextualTestOwnerOperationSchema, test: contextualTestListTestSchema, result: z.json(),
}).strict()
export const contextualTestOwnerRpcEnvelopeSchema = contextualTestDraftGetRpcEnvelopeSchema

export async function resolveContextualTestOwnerParams<T>(request: Request, params: Promise<T>, deadline: number): Promise<T> {
  const unavailable = () => new ApiError(503, 'Unable to verify test operation')
  let timer: ReturnType<typeof setTimeout> | undefined
  const abort = new AbortController(); const callerAbort = () => abort.abort()
  request.signal.addEventListener('abort', callerAbort, { once: true })
  try {
    const value = await Promise.race([params, new Promise<never>((_, reject) => {
      abort.signal.addEventListener('abort', () => reject(unavailable()), { once: true })
      timer = setTimeout(callerAbort, Math.max(0, deadline - Date.now()))
      if (request.signal.aborted || !Number.isFinite(deadline) || Date.now() >= deadline) callerAbort()
    })])
    if (Date.now() >= deadline || request.signal.aborted) throw unavailable()
    return value
  } catch { throw unavailable() }
  finally { clearTimeout(timer); request.signal.removeEventListener('abort', callerAbort) }
}

/** One finite body read; its deadline is carried into every transaction. */
export async function readContextualTestOwnerBody(request: Request, deadline: number): Promise<unknown> {
  const unavailable = () => new ApiError(503, 'Unable to verify test operation')
  const invalid = () => new ApiError(400, 'Invalid test operation body')
  const length = request.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > TEST_OWNER_WORKFLOW_BODY_BYTES)) throw invalid()
  if (!request.body || request.bodyUsed || request.body.locked) throw invalid()
  const reader = request.body.getReader()
  let timer: ReturnType<typeof setTimeout> | undefined
  const controller = new AbortController()
  const abort = () => controller.abort()
  request.signal.addEventListener('abort', abort, { once: true })
  try {
    const reading = async () => {
      const decoder = new TextDecoder('utf-8', { fatal: true }); let text = ''; let bytes = 0; let chunks = 0
      for (;;) {
        if (controller.signal.aborted || Date.now() >= deadline) throw unavailable()
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > TEST_OWNER_WORKFLOW_BODY_BYTES || ++chunks > TEST_OWNER_WORKFLOW_BODY_BYTES) throw invalid()
        text += decoder.decode(chunk.value, { stream: true })
      }
      text += decoder.decode()
      if (controller.signal.aborted || Date.now() >= deadline) throw unavailable()
      const body: unknown = JSON.parse(text)
      if (!boundedAssignmentListJson(body, TEST_OWNER_WORKFLOW_BODY_BYTES)) throw invalid()
      return body
    }
    return await Promise.race([reading(), new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(unavailable()), { once: true })
      timer = setTimeout(abort, Math.max(0, deadline - Date.now()))
      if (request.signal.aborted || !Number.isFinite(deadline) || Date.now() >= deadline) abort()
    })])
  } catch (error) { if (error instanceof ApiError) throw error; throw invalid() }
  finally { clearTimeout(timer); request.signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); reader.releaseLock() }
}

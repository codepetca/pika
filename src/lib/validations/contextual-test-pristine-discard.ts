import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import { contextualTestListTestSchema } from '@/lib/validations/contextual-test-list-read'
import { contextualTestDraftGetRowSchema, contextualTestDraftGetRpcEnvelopeSchema } from '@/lib/validations/contextual-test-draft-get'

export const TEST_PRISTINE_DISCARD_BODY_BYTES = 16 * 1024
export const TEST_PRISTINE_DISCARD_ROW_BYTES = 2 * 1024 * 1024
export const TEST_PRISTINE_DISCARD_ENVELOPE_BYTES = 4 * 1024 * 1024
export const TEST_PRISTINE_DISCARD_TOTAL_BYTES = 16 * 1024 * 1024
export const TEST_PRISTINE_DISCARD_DEADLINE_MS = 20000
const inputUuid = z.string().uuid().transform(value => value.toLowerCase())
const uuid = contextualTestListTestSchema.shape.id
const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)))
export const contextualTestPristineDiscardIdentitySchema = z.object({ actorId: inputUuid, testId: inputUuid }).strict()
export const contextualTestPristineDiscardQuerySchema = z.object({ testId: inputUuid }).strict()
export const contextualTestPristineDiscardRequestSchema = z.unknown().refine(value => boundedAssignmentListJson(value, TEST_PRISTINE_DISCARD_BODY_BYTES), 'Discard body exceeds limits').pipe(z.object({
  expected_draft_version: z.number().int().positive().max(2147483647), expected_test_updated_at: timestamp,
}).strict())
export type ContextualTestPristineDiscardInput = z.infer<typeof contextualTestPristineDiscardRequestSchema>
const base = z.object({
  version: z.literal(1), actor_id: uuid, test_id: uuid,
  classroom: z.object({ id: uuid, teacher_id: uuid, archived_at: z.null() }).strict(),
  test: contextualTestListTestSchema,
}).strict()
export const contextualTestPristineDiscardResultSchema = z.discriminatedUnion('discarded', [
  base.extend({ discarded: z.literal(true), draft: contextualTestDraftGetRowSchema }).strict(),
  base.extend({ discarded: z.literal(false), reason: z.literal('draft_changed'), draft: contextualTestDraftGetRowSchema.nullable() }).strict(),
])
export const contextualTestPristineDiscardRpcEnvelopeSchema = contextualTestDraftGetRpcEnvelopeSchema

/** Decode once under the route's absolute budget. Return actual stream bytes
 * alongside unknown JSON; the route passes both budget and count to the helper. */
export async function readContextualTestPristineDiscardBody(request: Request, deadline = Date.now() + TEST_PRISTINE_DISCARD_DEADLINE_MS): Promise<{ body: unknown; bytes: number }> {
  const invalid = () => new ApiError(400, 'Invalid pristine test discard body')
  const unavailable = () => new ApiError(503, 'Unable to verify pristine test discard')
  const cancelUnread = () => { void request.body?.cancel().catch(() => {}) }
  const length = request.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > TEST_PRISTINE_DISCARD_BODY_BYTES)) { cancelUnread(); throw invalid() }
  if (!request.body) throw invalid()
  if (!Number.isFinite(deadline) || Date.now() >= deadline || request.signal.aborted) { cancelUnread(); throw unavailable() }
  const reader = request.body.getReader()
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  const checkDeadline = () => { if (Date.now() >= deadline || request.signal.aborted) throw unavailable() }
  try {
    const reading = async () => {
      const decoder = new TextDecoder('utf-8', { fatal: true }); let text = ''; let bytes = 0
      for (;;) {
        checkDeadline()
        const chunk = await reader.read()
        checkDeadline()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > TEST_PRISTINE_DISCARD_BODY_BYTES) throw invalid()
        text += decoder.decode(chunk.value, { stream: true })
      }
      text += decoder.decode()
      const body: unknown = JSON.parse(text)
      checkDeadline()
      return { body, bytes }
    }
    return await Promise.race([reading(), new Promise<never>((_, reject) => {
      abort = () => reject(unavailable())
      request.signal.addEventListener('abort', abort, { once: true })
      timer = setTimeout(abort, Math.max(0, deadline - Date.now()))
      if (request.signal.aborted) abort()
    })])
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw invalid()
  } finally {
    clearTimeout(timer)
    if (abort) request.signal.removeEventListener('abort', abort)
    // Cancel closes outstanding reads immediately. Do not await an untrusted
    // underlying cancel callback before releasing the reader or HTTP request.
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

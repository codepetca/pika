import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import { contextualTestListTestSchema } from '@/lib/validations/contextual-test-list-read'
import { contextualTestDraftGetRpcEnvelopeSchema } from '@/lib/validations/contextual-test-draft-get'

export const TEST_PUBLICATION_BODY_BYTES = 16 * 1024
export const TEST_PUBLICATION_ROW_BYTES = 2 * 1024 * 1024
export const TEST_PUBLICATION_CONTENT_BYTES = 2 * 1024 * 1024
export const TEST_PUBLICATION_ENVELOPE_BYTES = 8 * 1024 * 1024
export const TEST_PUBLICATION_TOTAL_BYTES = 64 * 1024 * 1024
export const TEST_PUBLICATION_DEADLINE_MS = 20000
const inputUuid = z.string().uuid().transform(value => value.toLowerCase())
const uuid = contextualTestListTestSchema.shape.id
export const contextualTestPublicationQuerySchema = z.object({ testId: inputUuid }).strict()
export const contextualTestPublicationIdentitySchema = contextualTestPublicationQuerySchema.extend({ actorId: inputUuid }).strict()
export const contextualTestPublicationRequestSchema = z.unknown()
  .refine(value => boundedAssignmentListJson(value, TEST_PUBLICATION_BODY_BYTES))
  .pipe(z.object({ status: z.literal('closed'), draft_version: z.number().int().positive().max(2147483647) }).strict())
export type ContextualTestPublicationInput = z.infer<typeof contextualTestPublicationRequestSchema>
/** SQL retains its complete pre/postimages privately. This acknowledgement is
 * server-only; the route releases only the legacy {test} DTO. */
export const contextualTestPublicationResultSchema = z.object({
  version: z.literal(1), actor_id: uuid, classroom_id: uuid, test_id: uuid,
  source_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  draft_version: z.number().int().positive().max(2147483647), test: contextualTestListTestSchema,
}).strict()
export const contextualTestPublicationRpcEnvelopeSchema = contextualTestDraftGetRpcEnvelopeSchema

/** Scan grammar before the single whole-body JSON.parse. JSON string tokens
 * are decoded separately to compare escaped key identities. Sets are local to
 * each object, so sibling keys are independent and __proto__ is just a key.
 * The small body and explicit depth bound also bound CPU/stack consumption. */
function rejectDuplicateKeys(text: string, checkDeadline: () => void) {
  let cursor = 0
  const invalid = () => { throw new Error('Invalid publication JSON') }
  const whitespace = () => { while (/[\t\n\r ]/.test(text[cursor] ?? '') && cursor < text.length) cursor++ }
  const string = () => {
    const start = cursor++
    if (text[start] !== '"') return invalid()
    while (cursor < text.length) {
      if ((cursor & 511) === 0) checkDeadline()
      const char = text[cursor++]
      if (char === '\\') { cursor++; continue }
      if (char === '"') {
        const value: unknown = JSON.parse(text.slice(start, cursor))
        if (typeof value !== 'string') return invalid()
        return value
      }
    }
    return invalid()
  }
  const value = (depth: number): void => {
    checkDeadline(); if (depth > 64) invalid()
    whitespace()
    if (text[cursor] === '"') { string(); return }
    if (text[cursor] === '{') {
      cursor++; whitespace(); const keys = new Set<string>()
      if (text[cursor] === '}') { cursor++; return }
      for (;;) {
        whitespace(); const key = string()
        if (keys.has(key)) invalid(); keys.add(key)
        whitespace(); if (text[cursor++] !== ':') invalid()
        value(depth + 1); whitespace()
        const delimiter = text[cursor++]
        if (delimiter === '}') return
        if (delimiter !== ',') invalid()
      }
    }
    if (text[cursor] === '[') {
      cursor++; whitespace()
      if (text[cursor] === ']') { cursor++; return }
      for (;;) {
        value(depth + 1); whitespace()
        const delimiter = text[cursor++]
        if (delimiter === ']') return
        if (delimiter !== ',') invalid()
      }
    }
    const start = cursor
    while (cursor < text.length && !/[\t\n\r ,}\]]/.test(text[cursor])) cursor++
    if (cursor === start) invalid()
    // The final whole-body parser validates primitive token grammar.
  }
  value(0); whitespace(); if (cursor !== text.length) invalid()
}

/** One bounded stream read under the route's absolute deadline. Never await a
 * hostile cancel callback, clone the request, or recover via a second reader. */
export async function readContextualTestPublicationBody(request: Request, deadline = Date.now() + TEST_PUBLICATION_DEADLINE_MS): Promise<{ body: unknown; bytes: number }> {
  const invalid = () => new ApiError(400, 'Invalid test publication body')
  const unavailable = () => new ApiError(503, 'Unable to verify test publication')
  const cancelUnread = () => { void request.body?.cancel().catch(() => {}) }
  const length = request.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > TEST_PUBLICATION_BODY_BYTES)) { cancelUnread(); throw invalid() }
  if (!request.body || request.body.locked || request.bodyUsed) throw invalid()
  if (!Number.isFinite(deadline) || Date.now() >= deadline || request.signal.aborted) { cancelUnread(); throw unavailable() }
  const reader = request.body.getReader()
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  const checkDeadline = () => { if (Date.now() >= deadline || request.signal.aborted) throw unavailable() }
  try {
    const reading = async () => {
      const decoder = new TextDecoder('utf-8', { fatal: true }); let text = ''; let bytes = 0; let reads = 0
      for (;;) {
        if (++reads > TEST_PUBLICATION_BODY_BYTES + 1) throw invalid()
        checkDeadline(); const chunk = await reader.read(); checkDeadline()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > TEST_PUBLICATION_BODY_BYTES) throw invalid()
        text += decoder.decode(chunk.value, { stream: true })
      }
      text += decoder.decode(); rejectDuplicateKeys(text, checkDeadline)
      const body: unknown = JSON.parse(text)
      if (body === null || typeof body !== 'object' || Array.isArray(body)) throw invalid()
      checkDeadline(); return { body, bytes }
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
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

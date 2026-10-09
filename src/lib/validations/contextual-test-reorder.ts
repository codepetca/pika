import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import { contextualTestDraftGetRpcEnvelopeSchema } from '@/lib/validations/contextual-test-draft-get'

export const TEST_REORDER_BODY_BYTES = 512 * 1024
export const TEST_REORDER_WITNESS_BYTES = 512 * 1024
export const TEST_REORDER_ENVELOPE_BYTES = 1024 * 1024
export const TEST_REORDER_COLLECTION_LIMIT = 1000
export const TEST_REORDER_DEADLINE_MS = 20000
const inputUuid = z.string().uuid().transform(value => value.toLowerCase())
const uuid = z.string().uuid().refine(value => value === value.toLowerCase())
const count = z.number().int().nonnegative().max(TEST_REORDER_COLLECTION_LIMIT)
export const contextualTestReorderIdentitySchema = z.object({ actorId: inputUuid }).strict()
export const contextualTestReorderRequestSchema = z.unknown()
  .refine(value => boundedAssignmentListJson(value, TEST_REORDER_BODY_BYTES))
  .pipe(z.object({
    classroom_id: inputUuid,
    test_ids: z.array(inputUuid).max(TEST_REORDER_COLLECTION_LIMIT).refine(ids => new Set(ids).size === ids.length, 'Duplicate Test IDs'),
  }).strict())
export type ContextualTestReorderInput = z.infer<typeof contextualTestReorderRequestSchema>

/** This complete acknowledgement is private to the server helper. SQL owns
 * full row preservation; HTTP binds its identity, membership and positions. */
export const contextualTestReorderResultSchema = z.object({
  version: z.literal(1), actor_id: uuid, classroom_id: uuid,
  test_ids: z.array(uuid).max(TEST_REORDER_COLLECTION_LIMIT),
  positions: z.array(z.number().int().nonnegative().max(TEST_REORDER_COLLECTION_LIMIT - 1)).max(TEST_REORDER_COLLECTION_LIMIT),
  count, changed_count: count,
}).strict()
export const contextualTestReorderRpcEnvelopeSchema = contextualTestDraftGetRpcEnvelopeSchema

/** Scan before whole-body decoding so JSON's last-key-wins behavior cannot
 * hide duplicate decoded keys. Sets belong to each object, including nested
 * objects, and string tokens decode escaped key equivalence. */
function rejectDuplicateKeys(text: string, checkDeadline: () => void) {
  let cursor = 0
  const invalid = () => { throw new Error('Invalid reorder JSON') }
  const whitespace = () => { while (cursor < text.length && /[\t\n\r ]/.test(text[cursor])) cursor++ }
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
    // Whole-body JSON.parse validates primitive grammar.
  }
  value(0); whitespace(); if (cursor !== text.length) invalid()
}

/** One finite stream read under the route's body-plus-RPC deadline. Do not
 * await cancellation callbacks, clone a request, or acquire a second reader. */
export async function readContextualTestReorderBody(request: Request, deadline = Date.now() + TEST_REORDER_DEADLINE_MS): Promise<{ body: unknown; bytes: number }> {
  const invalid = () => new ApiError(400, 'Invalid test reorder body')
  const unavailable = () => new ApiError(503, 'Unable to verify test reorder')
  const cancelUnread = () => { void request.body?.cancel().catch(() => {}) }
  const length = request.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > TEST_REORDER_BODY_BYTES)) { cancelUnread(); throw invalid() }
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
        if (++reads > TEST_REORDER_BODY_BYTES + 1) throw invalid()
        checkDeadline(); const chunk = await reader.read(); checkDeadline()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > TEST_REORDER_BODY_BYTES) throw invalid()
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

import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import { contextualTestListIdentitySchema, contextualTestListTestSchema } from '@/lib/validations/contextual-test-list-read'
import { contextualTestDraftGetRowSchema, contextualTestDraftGetRpcEnvelopeSchema } from '@/lib/validations/contextual-test-draft-get'
import { UUID_V4_PATTERN } from '@/lib/course-blueprint-artifact-identity'

export const TEST_CREATE_BODY_BYTES = 16 * 1024
export const TEST_CREATE_ENVELOPE_BYTES = 16 * 1024
export const TEST_CREATE_TOTAL_BYTES = 64 * 1024
export const TEST_CREATE_TITLE_UNITS = 500
export const TEST_CREATE_DEADLINE_MS = 20000
const inputUuid = z.string().uuid().transform(value => value.toLowerCase())
const generatedUuid = contextualTestListTestSchema.shape.id.refine(value => UUID_V4_PATTERN.test(value))
const title = z.string().max(TEST_CREATE_TITLE_UNITS).refine(value => !value.includes('\0')
  && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value), 'Invalid title text')
/** The cap uses JavaScript UTF16 units, matching Zod max; PostgreSQL's
 * independent character count can admit more supplementary characters. */
export const contextualTestCreateRequestSchema = z.unknown().refine(value => boundedAssignmentListJson(value, TEST_CREATE_BODY_BYTES), 'Test create body exceeds limits').pipe(z.object({
  classroom_id: inputUuid, title: title.nullable().optional(),
}).strict())
export type ContextualTestCreateInput = z.infer<typeof contextualTestCreateRequestSchema>
export const contextualTestCreateIdentitySchema = contextualTestListIdentitySchema
export const contextualTestCreateTestSchema = contextualTestListTestSchema.extend({
  id: generatedUuid, artifact_id: generatedUuid, title,
  status: z.literal('draft'), show_results: z.literal(false), documents: z.array(z.never()).length(0),
  position: z.number().int().min(-2147483648).max(2147483647), points_possible: z.literal(100), include_in_final: z.literal(true),
  source_artifact_id: z.null(), source_blueprint_version_id: z.null(), blueprint_archived_at: z.null(), questions_locked_at: z.null(),
  gradebook_maximum_override: z.null(), gradebook_score_scale: z.literal(1), gradebook_weight: z.number().int().min(0).max(999),
}).strict()
export const contextualTestCreateContentSchema = z.object({
  title, show_results: z.literal(false), question_identity_version: z.literal(1), questions: z.array(z.never()).length(0), source_format: z.literal('markdown'),
}).strict()
export const contextualTestCreateDraftSchema = contextualTestDraftGetRowSchema.extend({ id: generatedUuid, version: z.literal(1), content: contextualTestCreateContentSchema }).strict()
export const contextualTestCreateResultSchema = z.object({
  version: z.literal(1), actor_id: contextualTestListTestSchema.shape.created_by, classroom_id: contextualTestListTestSchema.shape.classroom_id,
  test_id: generatedUuid, test: contextualTestCreateTestSchema, draft: contextualTestCreateDraftSchema,
}).strict()
export const contextualTestCreateRpcEnvelopeSchema = contextualTestDraftGetRpcEnvelopeSchema

/** Return actual stream byte count with the untrusted JSON value. The route
 * decodes once and carries this count and absolute deadline into the helper. */
export async function readContextualTestCreateBody(request: Request, deadline = Date.now() + TEST_CREATE_DEADLINE_MS): Promise<{ body: unknown; bytes: number }> {
  const invalid = () => new ApiError(400, 'Invalid test creation body')
  const unavailable = () => new ApiError(503, 'Unable to verify test creation')
  const length = request.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > TEST_CREATE_BODY_BYTES)) {
    void request.body?.cancel().catch(() => {})
    throw invalid()
  }
  if (!request.body) throw invalid()
  if (!Number.isFinite(deadline) || Date.now() >= deadline || request.signal.aborted) {
    void request.body.cancel().catch(() => {})
    throw unavailable()
  }
  const reader = request.body.getReader()
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  try {
    const reading = async () => {
      const decoder = new TextDecoder('utf-8', { fatal: true }); let text = ''; let bytes = 0
      for (;;) {
        if (Date.now() >= deadline) throw unavailable()
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > TEST_CREATE_BODY_BYTES) throw invalid()
        text += decoder.decode(chunk.value, { stream: true })
      }
      text += decoder.decode()
      const body: unknown = JSON.parse(text)
      if (Date.now() >= deadline) throw unavailable()
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
    // A stalled read is canceled even when the timeout wins. Do not wait for
    // an untrusted underlying cancel callback to settle the HTTP operation.
    void reader.cancel().catch(() => {}).finally(() => reader.releaseLock())
  }
}

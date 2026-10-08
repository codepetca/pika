import { isDeepStrictEqual } from 'node:util'
import { ApiError } from '@/lib/api-error'
import { getFallbackAssessmentTitle } from '@/lib/assessment-titles'
import type { getServiceRoleClient } from '@/lib/supabase'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import {
  TEST_CREATE_BODY_BYTES, TEST_CREATE_ENVELOPE_BYTES, TEST_CREATE_TOTAL_BYTES, TEST_CREATE_DEADLINE_MS,
  contextualTestCreateIdentitySchema, contextualTestCreateResultSchema, contextualTestCreateRpcEnvelopeSchema,
  type ContextualTestCreateInput,
} from '@/lib/validations/contextual-test-create'

const unavailable = () => new ApiError(503, 'Unable to verify test creation')

/** One current-owner SQL transaction creates and verifies the complete pair.
 * An acknowledgement loss can leave a committed pair; never retry this POST,
 * issue compensating deletes, or use a separate-table/Storage fallback. */
export async function createContextualTest(input: {
  supabase: ReturnType<typeof getServiceRoleClient>; actorId: string; input: ContextualTestCreateInput; deadline?: number; bodyBytes?: number; signal?: AbortSignal;
}) {
  const identity = contextualTestCreateIdentitySchema.safeParse({ actorId: input.actorId, classroomId: input.input.classroom_id })
  if (!identity.success) throw new ApiError(400, 'Invalid test creation identity')
  const { actorId, classroomId } = identity.data
  const deadline = Math.min(input.deadline ?? Infinity, Date.now() + TEST_CREATE_DEADLINE_MS)
  if (!Number.isFinite(deadline) || Date.now() >= deadline || input.signal?.aborted) throw unavailable()
  let bytes = input.bodyBytes ?? 0
  if (!Number.isInteger(bytes) || bytes < 0 || bytes > TEST_CREATE_BODY_BYTES) throw unavailable()
  const controller = new AbortController()
  const callerAbort = () => controller.abort()
  input.signal?.addEventListener('abort', callerAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), deadline - Date.now())
  const checkDeadline = () => { if (controller.signal.aborted || Date.now() >= deadline) throw unavailable() }
  function bound(value: unknown, limit: number) {
    checkDeadline()
    if (!boundedAssignmentListJson(value, limit)) throw unavailable()
    bytes += Buffer.byteLength(JSON.stringify(value), 'utf8')
    if (bytes > TEST_CREATE_TOTAL_BYTES) throw unavailable()
    checkDeadline()
  }
  try {
    bound(input.input, TEST_CREATE_BODY_BYTES)
    const title = input.input.title?.trim() || getFallbackAssessmentTitle()
    const args = { p_actor_id: actorId, p_classroom_id: classroomId, p_title: title, p_deadline: new Date(deadline).toISOString() }
    bound(args, TEST_CREATE_ENVELOPE_BYTES)
    const pending = input.supabase.rpc('create_test_for_owner_v1', args).abortSignal(controller.signal)
    const result = await new Promise<unknown>((resolve, reject) => {
      const abort = () => reject(unavailable())
      controller.signal.addEventListener('abort', abort, { once: true })
      Promise.resolve(pending).then(value => { controller.signal.removeEventListener('abort', abort); resolve(value) }, error => {
        controller.signal.removeEventListener('abort', abort); reject(error)
      })
      if (controller.signal.aborted) abort()
    })
    bound(result, TEST_CREATE_ENVELOPE_BYTES)
    const envelope = contextualTestCreateRpcEnvelopeSchema.safeParse(result)
    if (!envelope.success) throw unavailable()
    const { data, error, status } = envelope.data
    if (error) {
      if (data !== null) throw unavailable()
      if (error.code === 'PT400') throw new ApiError(400, 'Invalid test creation request')
      if (error.code === 'PT403') throw new ApiError(403, 'Forbidden')
      if (error.code === 'PT404') throw new ApiError(404, 'Classroom not found')
      if (['PT409', '55P03', '40P01', '40001'].includes(error.code)) throw new ApiError(409, 'Test creation is busy')
      throw unavailable()
    }
    if (status !== undefined && (status < 200 || status >= 300)) throw unavailable()
    const decoded = contextualTestCreateResultSchema.safeParse(data)
    if (!decoded.success) throw unavailable()
    checkDeadline()
    const witness = decoded.data; const test = witness.test; const draft = witness.draft
    const canonical = { title, show_results: false, question_identity_version: 1, questions: [], source_format: 'markdown' }
    if (witness.actor_id !== actorId || witness.classroom_id !== classroomId || witness.test_id !== test.id
      || test.classroom_id !== classroomId || test.created_by !== actorId || test.title !== title
      || draft.assessment_id !== test.id || draft.classroom_id !== classroomId || draft.created_by !== actorId || draft.updated_by !== actorId
      || new Set([test.id, test.artifact_id, draft.id]).size !== 3 || !isDeepStrictEqual(draft.content, canonical)
      || test.updated_at !== test.created_at || draft.created_at !== test.created_at || draft.updated_at !== test.created_at
      || Date.parse(test.created_at) > Date.now() || Date.parse(test.created_at) > deadline
      || (test.gradebook_category_id === null && test.gradebook_weight !== 10)) throw unavailable()
    const response = { test: { ...test, documents: [], assessment_type: 'test' as const } }
    bound(response, TEST_CREATE_ENVELOPE_BYTES)
    return response
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw unavailable()
  } finally { clearTimeout(timer); input.signal?.removeEventListener('abort', callerAbort); controller.abort() }
}

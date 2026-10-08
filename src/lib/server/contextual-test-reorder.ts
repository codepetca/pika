import { ApiError } from '@/lib/api-error'
import type { getServiceRoleClient } from '@/lib/supabase'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import {
  TEST_REORDER_BODY_BYTES, TEST_REORDER_WITNESS_BYTES, TEST_REORDER_ENVELOPE_BYTES, TEST_REORDER_DEADLINE_MS,
  contextualTestReorderIdentitySchema, contextualTestReorderResultSchema, contextualTestReorderRpcEnvelopeSchema,
  type ContextualTestReorderInput,
} from '@/lib/validations/contextual-test-reorder'

const unavailable = () => new ApiError(503, 'Unable to verify test reorder')

/** Exactly one owner-authorized SQL write. Missing or malformed commit
 * acknowledgement is unavailable and never triggers retry or compensation. */
export async function reorderContextualTests(input: {
  supabase: ReturnType<typeof getServiceRoleClient>; actorId: string; input: ContextualTestReorderInput;
  deadline?: number; bodyBytes?: number; signal?: AbortSignal;
}): Promise<{ success: true }> {
  const identity = contextualTestReorderIdentitySchema.safeParse({ actorId: input.actorId })
  if (!identity.success) throw new ApiError(400, 'Invalid test reorder identity')
  const { actorId } = identity.data
  if (input.deadline !== undefined && !Number.isFinite(input.deadline)) throw unavailable()
  const deadline = Math.min(input.deadline ?? Infinity, Date.now() + TEST_REORDER_DEADLINE_MS)
  if (!Number.isFinite(deadline) || Date.now() >= deadline || input.signal?.aborted) throw unavailable()
  const bodyBytes = input.bodyBytes ?? 0
  if (!Number.isInteger(bodyBytes) || bodyBytes < 0 || bodyBytes > TEST_REORDER_BODY_BYTES) throw unavailable()
  const controller = new AbortController()
  const callerAbort = () => controller.abort()
  input.signal?.addEventListener('abort', callerAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()))
  const checkDeadline = () => { if (controller.signal.aborted || Date.now() >= deadline) throw unavailable() }
  function bound(value: unknown, limit: number) {
    checkDeadline()
    if (!boundedAssignmentListJson(value, limit)) throw unavailable()
    checkDeadline()
  }
  try {
    bound(input.input, TEST_REORDER_BODY_BYTES)
    const args = { p_actor_id: actorId, p_classroom_id: input.input.classroom_id,
      p_test_ids: input.input.test_ids, p_deadline: new Date(deadline).toISOString() }
    bound(args, TEST_REORDER_ENVELOPE_BYTES)
    checkDeadline()
    const pending = input.supabase.rpc('reorder_tests_for_owner_v1', args).abortSignal(controller.signal)
    const raw = await new Promise<unknown>((resolve, reject) => {
      const abort = () => { controller.signal.removeEventListener('abort', abort); reject(unavailable()) }
      controller.signal.addEventListener('abort', abort, { once: true })
      Promise.resolve(pending).then(value => {
        controller.signal.removeEventListener('abort', abort); resolve(value)
      }, error => { controller.signal.removeEventListener('abort', abort); reject(error) })
      if (controller.signal.aborted) abort()
    })
    bound(raw, TEST_REORDER_ENVELOPE_BYTES)
    const envelope = contextualTestReorderRpcEnvelopeSchema.safeParse(raw)
    if (!envelope.success) throw unavailable()
    const { data, error, status } = envelope.data
    if (error) {
      if (data !== null) throw unavailable()
      if (error.code === 'PT400') throw new ApiError(400, 'Invalid test reorder request')
      if (error.code === 'PT403') throw new ApiError(403, 'Forbidden')
      if (error.code === 'PT404') throw new ApiError(404, 'Classroom not found')
      if (['PT409', '55P03', '40P01', '40001'].includes(error.code)) throw new ApiError(409, 'Test membership changed or classroom busy')
      throw unavailable()
    }
    if (status !== undefined && (status < 200 || status >= 300)) throw unavailable()
    bound(data, TEST_REORDER_WITNESS_BYTES)
    const completed = contextualTestReorderResultSchema.safeParse(data)
    if (!completed.success) throw unavailable()
    const witness = completed.data; const ids = input.input.test_ids
    if (witness.actor_id !== actorId || witness.classroom_id !== input.input.classroom_id
      || witness.count !== ids.length || witness.changed_count > witness.count
      || witness.test_ids.length !== ids.length || witness.positions.length !== ids.length) throw unavailable()
    for (let index = 0; index < ids.length; index++) {
      if (witness.test_ids[index] !== ids[index] || witness.positions[index] !== ids.length - index - 1) throw unavailable()
    }
    checkDeadline()
    return { success: true }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw unavailable()
  } finally {
    clearTimeout(timer); input.signal?.removeEventListener('abort', callerAbort); controller.abort()
  }
}

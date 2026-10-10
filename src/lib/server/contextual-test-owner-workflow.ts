import { ApiError } from '@/lib/api-error'
import type { getServiceRoleClient } from '@/lib/supabase'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import {
  contextualTestOwnerIdentitySchema, contextualTestOwnerWitnessSchema, contextualTestOwnerRpcEnvelopeSchema,
  TEST_OWNER_WORKFLOW_DEADLINE_MS, TEST_OWNER_WORKFLOW_ROW_BYTES, type TestOwnerOperation,
} from '@/lib/validations/contextual-test-owner-workflow'
import type { Json } from '@/types/database.generated'

const unavailable = () => new ApiError(503, 'Unable to verify test operation')

/** Admission is owned by the routes. Each service-only transaction independently
 * proves current authority and the fixed parent; acknowledgements are never retried. */
export function createContextualTestOwnerWorkflow(input: {
  supabase: ReturnType<typeof getServiceRoleClient>; actorId: string; testId: string; deadline?: number; signal?: AbortSignal;
}) {
  const { actorId, testId } = contextualTestOwnerIdentitySchema.parse({ actorId: input.actorId, testId: input.testId })
  const deadline = Math.min(input.deadline ?? Infinity, Date.now() + TEST_OWNER_WORKFLOW_DEADLINE_MS)
  let captured: ReturnType<typeof contextualTestOwnerWitnessSchema.parse>['test'] | undefined
  let statements = 0; let bytes = 0
  async function within<T>(operation: () => PromiseLike<T>): Promise<T> {
    if (!Number.isFinite(deadline) || Date.now() >= deadline || input.signal?.aborted) throw unavailable()
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort: (() => void) | undefined
    try {
      return await Promise.race([operation(), new Promise<never>((_, reject) => {
        abort = () => reject(unavailable())
        input.signal?.addEventListener('abort', abort, { once: true })
        timer = setTimeout(abort, Math.max(0, deadline - Date.now()))
        if (input.signal?.aborted) abort()
      })])
    } finally { clearTimeout(timer); if (abort) input.signal?.removeEventListener('abort', abort) }
  }
  async function execute(operation: TestOwnerOperation, payload: Json = {}) {
    if (!Number.isFinite(deadline) || Date.now() >= deadline || input.signal?.aborted || ++statements > 16) throw unavailable()
    if (operation !== 'inspect' && !captured) throw unavailable()
    const controller = new AbortController(); const abort = () => controller.abort()
    input.signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, deadline - Date.now())
    try {
      const pending = input.supabase.rpc('test_owner_workflow_v1', {
        p_actor_id: actorId, p_test_id: testId, p_classroom_id: captured?.classroom_id ?? null,
        p_operation: operation, p_payload: payload, p_expected_test: captured ?? null, p_deadline: new Date(deadline).toISOString(),
      }).abortSignal(controller.signal)
      const raw = await Promise.race([pending, new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(unavailable()), { once: true })
        if (controller.signal.aborted) reject(unavailable())
      })])
      if (controller.signal.aborted || Date.now() >= deadline || !boundedAssignmentListJson(raw, TEST_OWNER_WORKFLOW_ROW_BYTES)) throw unavailable()
      bytes += Buffer.byteLength(JSON.stringify(raw), 'utf8'); if (bytes > 32 * 1024 * 1024) throw unavailable()
      const envelope = contextualTestOwnerRpcEnvelopeSchema.safeParse(raw)
      if (!envelope.success) throw unavailable()
      if (envelope.data.error) {
        const statuses: Record<string, number> = { PT400: 400, PT403: 403, PT404: 404, PT409: 409 }
        const status = statuses[envelope.data.error.code]
        if (envelope.data.data !== null || !status) throw unavailable()
        const messages: Record<number, string> = { 400: 'Invalid test operation', 403: 'Forbidden', 404: 'Test document or classroom not found', 409: 'Test changed; reload and retry' }
        throw new ApiError(status, messages[status])
      }
      if (envelope.data.status !== undefined && (envelope.data.status < 200 || envelope.data.status >= 300)) throw unavailable()
      const parsed = contextualTestOwnerWitnessSchema.safeParse(envelope.data.data)
      if (!parsed.success) throw unavailable()
      const witness = parsed.data
      if (witness.actor_id !== actorId || witness.test_id !== testId || witness.operation !== operation
        || witness.test.id !== testId || witness.test.classroom_id !== witness.classroom_id
        || (captured && witness.classroom_id !== captured.classroom_id)) throw unavailable()
      // Keep one original CAS source. A reserve/verify acknowledgement may
      // observe a concurrent metadata edit but must never silently refresh the
      // snapshot attachment's expected Test.
      captured ??= witness.test
      return witness
    } catch (error) { if (error instanceof ApiError) throw error; throw unavailable() }
    finally { clearTimeout(timer); input.signal?.removeEventListener('abort', abort); controller.abort() }
  }
  return {
    deadline,
    within,
    async inspect() { return (await execute('inspect')).test },
    run: execute,
  }
}

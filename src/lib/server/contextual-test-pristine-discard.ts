import { ApiError } from '@/lib/api-error'
import type { getServiceRoleClient } from '@/lib/supabase'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import {
  TEST_PRISTINE_DISCARD_BODY_BYTES, TEST_PRISTINE_DISCARD_ROW_BYTES, TEST_PRISTINE_DISCARD_ENVELOPE_BYTES,
  TEST_PRISTINE_DISCARD_TOTAL_BYTES, TEST_PRISTINE_DISCARD_DEADLINE_MS,
  contextualTestPristineDiscardIdentitySchema, contextualTestPristineDiscardRequestSchema,
  contextualTestPristineDiscardResultSchema, contextualTestPristineDiscardRpcEnvelopeSchema,
  type ContextualTestPristineDiscardInput,
} from '@/lib/validations/contextual-test-pristine-discard'

const unavailable = () => new ApiError(503, 'Unable to verify pristine test discard')
const isoFraction = /(?:\.(\d+))?(?:Z|[+-]\d{2}:\d{2})$/
/** Match the existing microsecond-safe Daily Log comparison: Date.parse alone
 * truncates PostgreSQL fractions, while offsets must compare as UTC instants. */
function sameTimestampInstant(left: string, right: string) {
  const leftMillis = Date.parse(left); const rightMillis = Date.parse(right)
  if (!Number.isFinite(leftMillis) || !Number.isFinite(rightMillis) || !isoFraction.test(left) || !isoFraction.test(right)) return false
  if (Math.floor(leftMillis / 1000) !== Math.floor(rightMillis / 1000)) return false
  const leftFraction = isoFraction.exec(left)?.[1] ?? ''; const rightFraction = isoFraction.exec(right)?.[1] ?? ''
  const width = Math.max(leftFraction.length, rightFraction.length)
  return leftFraction.padEnd(width, '0') === rightFraction.padEnd(width, '0')
}

/** SQL owns current active-owner authority, dual CAS and exact atomic effects.
 * Lost acknowledgement may follow complete deletion; never retry or compensate. */
export async function discardContextualPristineTestDraft(input: {
  supabase: ReturnType<typeof getServiceRoleClient>; actorId: string; testId: string; input: ContextualTestPristineDiscardInput;
  deadline?: number; bodyBytes?: number; signal?: AbortSignal;
}) {
  const identity = contextualTestPristineDiscardIdentitySchema.safeParse({ actorId: input.actorId, testId: input.testId })
  const parsed = contextualTestPristineDiscardRequestSchema.safeParse(input.input)
  if (!identity.success || !parsed.success) throw new ApiError(400, 'Invalid pristine test discard request')
  const { actorId, testId } = identity.data
  const deadline = Math.min(input.deadline ?? Infinity, Date.now() + TEST_PRISTINE_DISCARD_DEADLINE_MS)
  if (!Number.isFinite(deadline) || Date.now() >= deadline || input.signal?.aborted) throw unavailable()
  let bytes = input.bodyBytes ?? 0
  if (!Number.isInteger(bytes) || bytes < 0 || bytes > TEST_PRISTINE_DISCARD_BODY_BYTES) throw unavailable()
  const controller = new AbortController()
  const callerAbort = () => controller.abort()
  input.signal?.addEventListener('abort', callerAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()))
  const checkDeadline = () => { if (controller.signal.aborted || Date.now() >= deadline) throw unavailable() }
  function bound(value: unknown, limit: number) {
    checkDeadline()
    if (!boundedAssignmentListJson(value, limit)) throw unavailable()
    bytes += Buffer.byteLength(JSON.stringify(value), 'utf8')
    if (bytes > TEST_PRISTINE_DISCARD_TOTAL_BYTES) throw unavailable()
    checkDeadline()
  }
  try {
    bound(parsed.data, TEST_PRISTINE_DISCARD_BODY_BYTES)
    const args = { p_actor_id: actorId, p_test_id: testId, p_expected_draft_version: parsed.data.expected_draft_version,
      p_expected_test_updated_at: parsed.data.expected_test_updated_at, p_deadline: new Date(deadline).toISOString() }
    bound(args, TEST_PRISTINE_DISCARD_BODY_BYTES)
    const pending = input.supabase.rpc('discard_pristine_test_draft_for_owner_v1', args).abortSignal(controller.signal)
    const result = await new Promise<unknown>((resolve, reject) => {
      const abort = () => { controller.signal.removeEventListener('abort', abort); reject(unavailable()) }
      controller.signal.addEventListener('abort', abort, { once: true })
      Promise.resolve(pending).then(value => { controller.signal.removeEventListener('abort', abort); resolve(value) }, error => {
        controller.signal.removeEventListener('abort', abort); reject(error)
      })
      if (controller.signal.aborted) abort()
    })
    bound(result, TEST_PRISTINE_DISCARD_ENVELOPE_BYTES)
    const envelope = contextualTestPristineDiscardRpcEnvelopeSchema.safeParse(result)
    if (!envelope.success) throw unavailable()
    const { data, error, status } = envelope.data
    if (error) {
      if (data !== null) throw unavailable()
      if (error.code === 'PT400') throw new ApiError(400, 'Invalid pristine test discard request')
      if (error.code === 'PT403') throw new ApiError(403, 'Forbidden')
      if (error.code === 'PT404') throw new ApiError(404, 'Test not found')
      if (['PT409', '55P03', '40P01', '40001'].includes(error.code)) throw new ApiError(409, 'Pristine test discard is busy')
      throw unavailable()
    }
    if (status !== undefined && (status < 200 || status >= 300)) throw unavailable()
    // Bound complete raw rows before schema cloning; title/document metadata
    // must not hide overlarge source material through normalization.
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
      if ('test' in data) bound(data.test, TEST_PRISTINE_DISCARD_ROW_BYTES)
      if ('draft' in data && data.draft !== null) bound(data.draft, TEST_PRISTINE_DISCARD_ROW_BYTES)
    }
    const decoded = contextualTestPristineDiscardResultSchema.safeParse(data)
    if (!decoded.success) throw unavailable()
    const witness = decoded.data; const test = witness.test; const draft = witness.draft
    bound(witness, TEST_PRISTINE_DISCARD_ENVELOPE_BYTES)
    if (witness.actor_id !== actorId || witness.test_id !== testId || test.id !== testId
      || witness.classroom.teacher_id !== actorId || test.classroom_id !== witness.classroom.id || test.blueprint_archived_at !== null
      || (draft && (draft.assessment_id !== testId || draft.classroom_id !== witness.classroom.id))
      || (witness.discarded && (witness.draft.version !== parsed.data.expected_draft_version
        || !sameTimestampInstant(test.updated_at, parsed.data.expected_test_updated_at)))) throw unavailable()
    const response = witness.discarded ? { discarded: true as const } : { discarded: false as const, test }
    bound(response, TEST_PRISTINE_DISCARD_ENVELOPE_BYTES)
    return response
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw unavailable()
  } finally { clearTimeout(timer); input.signal?.removeEventListener('abort', callerAbort); controller.abort() }
}

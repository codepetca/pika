import { ApiError } from '@/lib/api-error'
import { getEffectiveStudentTestAccess } from '@/lib/server/tests'
import { getStudentTestStatus } from '@/lib/tests'
import { boundedAssignmentListJson } from '@/lib/validations/contextual-assignment-list-read'
import { contextualTestDraftGetRpcEnvelopeSchema } from '@/lib/validations/contextual-test-draft-get'
import { testLearnerIdentitySchema } from '@/lib/validations/contextual-test-learner-workflow'
import { TEST_SESSION_READ_BYTES, testSessionReadSnapshotSchema } from '@/lib/validations/contextual-test-session-read'

/** Exact source signature until the coordinator installs genuine CLI metadata. */
export type TestSessionReadClient = { rpc(name: 'read_test_session_for_member_v1', args: {
  p_actor_id: string; p_test_id: string; p_deadline: string;
}): { abortSignal(signal: AbortSignal): PromiseLike<unknown> } }
const unavailable = () => new ApiError(503, 'Unable to verify test operation')

export function presentContextualTestSession(projection: { testId: string; test_status: 'active' | 'closed';
  has_submitted: boolean; returned_at: string | null; closed_for_grading_at: string | null;
  access_state: 'open' | 'closed' | null }) {
  const locked = projection.closed_for_grading_at !== null
  const access = getEffectiveStudentTestAccess({ testStatus: projection.test_status, accessState: projection.access_state,
    hasSubmitted: projection.has_submitted, returnedAt: projection.returned_at, isLockedForGrading: locked })
  const status = (projection.has_submitted || locked) && projection.returned_at && access.effective_access === 'closed'
    ? 'can_view_results' : locked ? 'responded' : getStudentTestStatus({ status: projection.test_status }, projection.has_submitted, projection.returned_at)
  const message = access.can_start_or_continue ? null : !projection.has_submitted && access.access_source === 'student'
    ? 'Your teacher closed access to this test. Your saved draft is preserved and can continue if your teacher opens it again.'
    : status === 'can_view_results' ? 'Your current work has been submitted. Results are now available from the tests list.'
    : status === 'responded' ? 'Your current work has been submitted.' : null
  return { test: { id: projection.testId, status: projection.test_status, assessment_type: 'test' as const, student_status: status,
    returned_at: projection.returned_at, access_state: access.access_state, effective_access: access.effective_access },
  student_status: status, returned_at: projection.returned_at, can_continue: access.can_start_or_continue, message }
}

/** Null means only that this additive RPC is definitively absent. The caller
 * retains the original contextual workflow, never the role-based legacy path. */
export async function readContextualTestSession(input: { supabase: TestSessionReadClient; actorId: string;
  testId: string; deadline: number; signal?: AbortSignal }) {
  const identity = testLearnerIdentitySchema.parse({ actorId: input.actorId, testId: input.testId })
  if (!Number.isFinite(input.deadline) || Date.now() >= input.deadline || input.signal?.aborted) throw unavailable()
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  try {
    const raw = await Promise.race([
      input.supabase.rpc('read_test_session_for_member_v1', { p_actor_id: identity.actorId,
        p_test_id: identity.testId, p_deadline: new Date(input.deadline).toISOString() }).abortSignal(controller.signal),
      new Promise<never>((_, reject) => {
        abort = () => { controller.abort(); reject(unavailable()) }
        input.signal?.addEventListener('abort', abort, { once: true })
        timer = setTimeout(abort, Math.max(0, input.deadline - Date.now()))
        if (input.signal?.aborted) abort()
      }),
    ])
    if (controller.signal.aborted || Date.now() >= input.deadline || !boundedAssignmentListJson(raw, TEST_SESSION_READ_BYTES)) throw unavailable()
    const envelope = contextualTestDraftGetRpcEnvelopeSchema.safeParse(raw)
    if (!envelope.success) throw unavailable()
    const { data, error, status } = envelope.data
    if (error) {
      if (data === null && error.code === 'PGRST202' && (status === undefined || status === 404)
        && /\bpublic\.read_test_session_for_member_v1(?:\(|\s|$)/.test(error.message)) return null
      throw unavailable()
    }
    if (status !== undefined && (status < 200 || status >= 300)) throw unavailable()
    const decoded = testSessionReadSnapshotSchema.safeParse(data)
    if (!decoded.success || decoded.data.actor_id !== identity.actorId || decoded.data.test_id !== identity.testId) throw unavailable()
    const snapshot = decoded.data
    if (snapshot.outcome !== 'ok') {
      if (snapshot.outcome === 'forbidden') throw new ApiError(403, 'Forbidden')
      if (snapshot.outcome === 'not_found') throw new ApiError(404, 'Test not found')
      throw unavailable()
    }
    // SQL submission precedence must agree even on inconsistent historical rows.
    if (snapshot.projection!.is_submitted && !snapshot.projection!.has_submitted) throw unavailable()
    return { testId: identity.testId, ...snapshot.projection! }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw unavailable()
  } finally {
    clearTimeout(timer)
    if (abort) input.signal?.removeEventListener('abort', abort)
    controller.abort()
  }
}

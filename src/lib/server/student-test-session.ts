import { z } from 'zod'
import { getServiceRoleClient } from '@/lib/supabase'
import { ApiError } from '@/lib/api-error'
import { hasAnyMeaningfulTestResponse } from '@/lib/test-responses'
import {
  assertStudentCanAccessTest,
  getTestStudentAvailabilityState,
  isMissingTestAttemptClosureColumnsError,
  isMissingTestAttemptReturnColumnsError,
} from '@/lib/server/tests'

const projectionSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(false), status: z.union([z.literal(403), z.literal(404)]), error: z.string() }).strict(),
  z.object({
    ok: z.literal(true), test: z.object({ id: z.string(), status: z.enum(['draft', 'active', 'closed']) }).strict(),
    is_submitted: z.boolean(), returned_at: z.string().nullable(), closed_for_grading_at: z.string().nullable(),
    has_meaningful_response: z.boolean(), access_state: z.enum(['open', 'closed']).nullable(),
  }).strict(),
])

/** Compatibility applies only to an explicitly absent migration-257 RPC.
 * Authentication stays in the route and is refreshed on every poll. */
export async function getStudentTestSessionProjection(studentId: string, testId: string) {
  const supabase = getServiceRoleClient()
  const result = await supabase.rpc('get_student_test_session_status_projection', {
    p_student_id: studentId, p_test_id: testId,
  })
  if (!result.error) {
    const parsed = projectionSchema.safeParse(result.data)
    if (!parsed.success) throw new ApiError(500, 'Failed to fetch test session status')
    return parsed.data
  }
  if (result.error.code !== 'PGRST202' || !(/\bpublic\.get_student_test_session_status_projection(?:\(|\s|$)/).test(result.error.message || '')) {
    throw new ApiError(500, 'Failed to fetch test session status')
  }
  return getLegacyStudentTestSessionProjection(studentId, testId, supabase)
}

async function getLegacyStudentTestSessionProjection(studentId: string, testId: string, supabase: ReturnType<typeof getServiceRoleClient>) {
  const access = await assertStudentCanAccessTest(studentId, testId)
  if (!access.ok) {
    return access
  }

  const test = access.test

  type AttemptRow = {
    is_submitted: boolean
    returned_at: string | null
    closed_for_grading_at: string | null
  }

  let attempt: AttemptRow | null = null
  let attemptError: { code?: string; message?: string; details?: string; hint?: string } | null = null

  {
    const attemptWithReturnResult = await supabase
      .from('test_attempts')
      .select('is_submitted, returned_at, closed_for_grading_at')
      .eq('test_id', testId)
      .eq('student_id', studentId)
      .maybeSingle()

    attempt = (attemptWithReturnResult.data as AttemptRow | null) || null
    attemptError = attemptWithReturnResult.error
  }

  if (
    attemptError &&
    (isMissingTestAttemptReturnColumnsError(attemptError) ||
      isMissingTestAttemptClosureColumnsError(attemptError))
  ) {
    const legacyAttemptResult = await supabase
      .from('test_attempts')
      .select('is_submitted')
      .eq('test_id', testId)
      .eq('student_id', studentId)
      .maybeSingle()

    attempt = (legacyAttemptResult.data
      ? {
          ...(legacyAttemptResult.data as { is_submitted: boolean }),
          returned_at: null,
          closed_for_grading_at: null,
        }
      : null)
    attemptError = legacyAttemptResult.error
  }

  if (attemptError && attemptError.code !== 'PGRST205') {
    console.error('Error fetching student test session status:', attemptError)
    throw new ApiError(500, 'Failed to fetch test session status')
  }

  const { data: responses, error: responsesError } = await supabase
    .from('test_responses')
    .select('selected_option, response_text')
    .eq('test_id', testId)
    .eq('student_id', studentId)

  if (responsesError) {
    console.error('Error checking submitted test responses for session status:', responsesError)
    throw new ApiError(500, 'Failed to fetch test session status')
  }

  const availabilityResult = await getTestStudentAvailabilityState(supabase, testId, studentId)
  if (availabilityResult.error && !availabilityResult.missingTable) {
    console.error('Error fetching student test access for session status:', availabilityResult.error)
    throw new ApiError(500, 'Failed to fetch test session status')
  }

  return {
    ok: true as const, test: { id: test.id, status: test.status },
    is_submitted: Boolean(attempt?.is_submitted), returned_at: attempt?.returned_at || null,
    closed_for_grading_at: attempt?.closed_for_grading_at || null,
    has_meaningful_response: hasAnyMeaningfulTestResponse(responses), access_state: availabilityResult.state,
  }
}

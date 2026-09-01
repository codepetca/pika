import { ApiError } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { hasAnyMeaningfulTestResponse } from '@/lib/test-responses'
import {
  assertStudentCanAccessTest,
  getEffectiveStudentTestAccess,
  getTestStudentAvailabilityState,
  isMissingTestAttemptClosureColumnsError,
  isMissingTestAttemptReturnColumnsError,
  type TestAccessRecord,
} from '@/lib/server/tests'

type StudentTestMaterialAccess =
  | { ok: true; test: TestAccessRecord }
  | { ok: false; status: number; error: string }

export async function getStudentTestMaterialAccess(
  studentId: string,
  testId: string,
): Promise<StudentTestMaterialAccess> {
  const access = await assertStudentCanAccessTest(studentId, testId)
  if (!access.ok) return access
  if (access.test.status === 'draft') {
    return { ok: false, status: 404, error: 'Document not found' }
  }

  const supabase = getServiceRoleClient()
  type AttemptRow = {
    is_submitted: boolean
    returned_at: string | null
    closed_for_grading_at: string | null
  }
  let attempt: AttemptRow | null = null
  let attemptError: { code?: string; message?: string; details?: string; hint?: string } | null = null

  const attemptResult = await supabase
    .from('test_attempts')
    .select('is_submitted, returned_at, closed_for_grading_at')
    .eq('test_id', testId)
    .eq('student_id', studentId)
    .maybeSingle()
  attempt = (attemptResult.data as AttemptRow | null) || null
  attemptError = attemptResult.error

  if (attemptError && (
    isMissingTestAttemptReturnColumnsError(attemptError)
    || isMissingTestAttemptClosureColumnsError(attemptError)
  )) {
    const legacyAttemptResult = await supabase
      .from('test_attempts')
      .select('is_submitted')
      .eq('test_id', testId)
      .eq('student_id', studentId)
      .maybeSingle()
    attempt = legacyAttemptResult.data
      ? {
          ...(legacyAttemptResult.data as { is_submitted: boolean }),
          returned_at: null,
          closed_for_grading_at: null,
        }
      : null
    attemptError = legacyAttemptResult.error
  }

  if (attemptError && attemptError.code !== 'PGRST205') {
    throw new ApiError(500, 'Failed to fetch test access')
  }

  const { data: responses, error: responsesError } = await supabase
    .from('test_responses')
    .select('selected_option, response_text')
    .eq('test_id', testId)
    .eq('student_id', studentId)
  if (responsesError) throw new ApiError(500, 'Failed to fetch test access')

  const isLockedForGrading = Boolean(attempt?.closed_for_grading_at)
  const hasSubmitted = Boolean(attempt?.is_submitted)
    || (!isLockedForGrading && hasAnyMeaningfulTestResponse(responses))
  const availabilityResult = await getTestStudentAvailabilityState(
    supabase,
    testId,
    studentId,
  )
  if (availabilityResult.error && !availabilityResult.missingTable) {
    throw new ApiError(500, 'Failed to fetch test access')
  }

  const accessState = getEffectiveStudentTestAccess({
    testStatus: access.test.status,
    accessState: availabilityResult.state,
    hasSubmitted,
    returnedAt: attempt?.returned_at || null,
    isLockedForGrading,
  })
  if (!accessState.can_start_or_continue && !accessState.can_view_submitted) {
    return { ok: false, status: 404, error: 'Document not found' }
  }

  return { ok: true, test: access.test }
}

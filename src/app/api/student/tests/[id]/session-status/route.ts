import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { getStudentTestStatus } from '@/lib/quizzes'
import {
  assertStudentCanAccessTest,
  getEffectiveStudentTestAccess,
  getTestStudentAvailabilityState,
  isMissingTestAttemptClosureColumnsError,
  isMissingTestAttemptReturnColumnsError,
} from '@/lib/server/tests'
import { hasAnyMeaningfulTestResponse } from '@/lib/test-responses'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function getSessionMessage(
  studentStatus: 'not_started' | 'responded' | 'can_view_results',
  options?: { studentAccessClosed?: boolean }
): string | null {
  if (options?.studentAccessClosed) {
    return 'Your teacher closed access to this test. Your saved draft is preserved and can continue if your teacher opens it again.'
  }
  if (studentStatus === 'can_view_results') {
    return 'Your current work has been submitted. Results are now available from the tests list.'
  }
  if (studentStatus === 'responded') {
    return 'Your current work has been submitted.'
  }
  return null
}

// GET /api/student/tests/[id]/session-status - Lightweight student test session revalidation
export const GET = withErrorHandler('GetStudentTestSessionStatus', async (_request, context) => {
  const user = await requireRole('student')
  const { id: testId } = await context.params

  const access = await assertStudentCanAccessTest(user.id, testId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const test = access.test
  const supabase = getServiceRoleClient()

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
      .eq('student_id', user.id)
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
      .eq('student_id', user.id)
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
    return NextResponse.json({ error: 'Failed to fetch test session status' }, { status: 500 })
  }

  const { data: responses, error: responsesError } = await supabase
    .from('test_responses')
    .select('selected_option, response_text')
    .eq('test_id', testId)
    .eq('student_id', user.id)

  if (responsesError) {
    console.error('Error checking submitted test responses for session status:', responsesError)
    return NextResponse.json({ error: 'Failed to fetch test session status' }, { status: 500 })
  }

  const isLockedForGrading = Boolean(attempt?.closed_for_grading_at)
  const hasSubmitted = Boolean(attempt?.is_submitted) || (!isLockedForGrading && hasAnyMeaningfulTestResponse(responses))
  const availabilityResult = await getTestStudentAvailabilityState(supabase, testId, user.id)
  if (availabilityResult.error && !availabilityResult.missingTable) {
    console.error('Error fetching student test access for session status:', availabilityResult.error)
    return NextResponse.json({ error: 'Failed to fetch test session status' }, { status: 500 })
  }
  const accessState = getEffectiveStudentTestAccess({
    testStatus: test.status,
    accessState: availabilityResult.state,
    hasSubmitted,
    returnedAt: attempt?.returned_at || null,
    isLockedForGrading,
  })

  if (test.status === 'draft') {
    return NextResponse.json({ error: 'Test not found' }, { status: 404 })
  }

  if (!accessState.can_start_or_continue && !accessState.can_view_submitted && accessState.access_source !== 'student') {
    return NextResponse.json({ error: 'Test not found' }, { status: 404 })
  }

  const studentStatus =
    (hasSubmitted || isLockedForGrading) && attempt?.returned_at && accessState.effective_access === 'closed'
      ? 'can_view_results'
      : isLockedForGrading
        ? 'responded'
        : getStudentTestStatus(test, hasSubmitted, attempt?.returned_at)
  const canContinue = accessState.can_start_or_continue

  return NextResponse.json({
    quiz: {
      id: test.id,
      status: test.status,
      assessment_type: 'test' as const,
      student_status: studentStatus,
      returned_at: attempt?.returned_at || null,
      access_state: accessState.access_state,
      effective_access: accessState.effective_access,
    },
    student_status: studentStatus,
    returned_at: attempt?.returned_at || null,
    can_continue: canContinue,
    message: canContinue
      ? null
      : getSessionMessage(studentStatus, {
          studentAccessClosed: !hasSubmitted && accessState.access_source === 'student',
        }),
  })
})

import { NextResponse } from 'next/server'
import { handleContextualTestLearnerRequest } from '@/lib/server/contextual-test-learner-workflow'
import { requireRole } from '@/lib/auth'
import { getStudentTestStatus } from '@/lib/tests'
import { getEffectiveStudentTestAccess } from '@/lib/server/tests'
import { getStudentTestSessionProjection } from '@/lib/server/student-test-session'
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
  const contextual = await handleContextualTestLearnerRequest('session', _request, context.params)
  if (contextual) return contextual
  const user = await requireRole('student')
  const { id: testId } = await context.params

  const projection = await getStudentTestSessionProjection(user.id, testId)
  if (!projection.ok) {
    return NextResponse.json({ error: projection.error }, { status: projection.status })
  }
  const test = projection.test
  const attempt = projection
  const isLockedForGrading = Boolean(attempt?.closed_for_grading_at)
  const hasSubmitted = Boolean(attempt?.is_submitted) || (!isLockedForGrading && projection.has_meaningful_response)
  const accessState = getEffectiveStudentTestAccess({
    testStatus: test.status,
    accessState: projection.access_state,
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

  const responseTest = {
    id: test.id,
    status: test.status,
    assessment_type: 'test' as const,
    student_status: studentStatus,
    returned_at: attempt?.returned_at || null,
    access_state: accessState.access_state,
    effective_access: accessState.effective_access,
  }

  return NextResponse.json({
    test: responseTest,
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

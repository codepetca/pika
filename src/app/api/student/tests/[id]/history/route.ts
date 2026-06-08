import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import {
  assertStudentCanAccessTest,
  assertTeacherOwnsTest,
  getEffectiveStudentTestAccess,
  getTestStudentAvailabilityState,
  isMissingTestAttemptClosureColumnsError,
  isMissingTestAttemptReturnColumnsError,
} from '@/lib/server/tests'
import { getServiceRoleClient } from '@/lib/supabase'
import { withErrorHandler } from '@/lib/api-handler'
import { hasAnyMeaningfulTestResponse } from '@/lib/test-responses'
import type { QuizStatus } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type AttemptRow = {
  id: string
  is_submitted: boolean
  returned_at: string | null
  closed_for_grading_at: string | null
}

// GET /api/student/tests/[id]/history - Get test draft history for student/teacher
export const GET = withErrorHandler('GetStudentTestHistory', async (request, context) => {
  const user = await requireAuth()
  const { id: testId } = await context.params
  const { searchParams } = new URL(request.url)
  const requestedStudentId = searchParams.get('student_id')
  const supabase = getServiceRoleClient()

  let studentId = user.id
  let studentTestStatus: QuizStatus = 'draft'

  if (user.role === 'teacher') {
    if (!requestedStudentId) {
      return NextResponse.json({ error: 'student_id is required' }, { status: 400 })
    }

    const access = await assertTeacherOwnsTest(user.id, testId)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    studentId = requestedStudentId
    const { data: enrollment } = await supabase
      .from('classroom_enrollments')
      .select('id')
      .eq('classroom_id', access.test.classroom_id)
      .eq('student_id', studentId)
      .single()

    if (!enrollment) {
      return NextResponse.json({ error: 'Not enrolled in this classroom' }, { status: 403 })
    }
  } else {
    const access = await assertStudentCanAccessTest(user.id, testId)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    studentTestStatus = access.test.status

    if (access.test.status === 'draft') {
      return NextResponse.json({ error: 'Test not found' }, { status: 404 })
    }
  }

  let attempt: AttemptRow | null = null
  let attemptError: { code?: string; message?: string; details?: string; hint?: string } | null = null
  let attemptTableMissing = false

  {
    const attemptResult = await supabase
      .from('test_attempts')
      .select('id, is_submitted, returned_at, closed_for_grading_at')
      .eq('test_id', testId)
      .eq('student_id', studentId)
      .maybeSingle()

    attempt = (attemptResult.data as AttemptRow | null) || null
    attemptError = attemptResult.error
  }

  if (
    attemptError &&
    (isMissingTestAttemptReturnColumnsError(attemptError) ||
      isMissingTestAttemptClosureColumnsError(attemptError))
  ) {
    const legacyAttemptResult = await supabase
      .from('test_attempts')
      .select('id, is_submitted')
      .eq('test_id', testId)
      .eq('student_id', studentId)
      .maybeSingle()

    attempt = legacyAttemptResult.data
      ? {
          ...(legacyAttemptResult.data as { id: string; is_submitted: boolean }),
          returned_at: null,
          closed_for_grading_at: null,
        }
      : null
    attemptError = legacyAttemptResult.error
  }

  if (attemptError?.code === 'PGRST205') {
    attemptTableMissing = true
    attemptError = null
  }

  if (attemptError) {
    console.error('Error fetching test attempt for history:', attemptError)
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 })
  }

  if (user.role !== 'teacher') {
    const { data: responses, error: responsesError } = await supabase
      .from('test_responses')
      .select('selected_option, response_text')
      .eq('test_id', testId)
      .eq('student_id', user.id)

    if (responsesError) {
      console.error('Error checking student test history responses:', responsesError)
      return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 })
    }

    const isLockedForGrading = Boolean(attempt?.closed_for_grading_at)
    const hasSubmitted =
      Boolean(attempt?.is_submitted) || (!isLockedForGrading && hasAnyMeaningfulTestResponse(responses))
    const availabilityResult = await getTestStudentAvailabilityState(supabase, testId, user.id)
    if (availabilityResult.error && !availabilityResult.missingTable) {
      console.error('Error checking student test history availability:', availabilityResult.error)
      return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 })
    }

    const accessState = getEffectiveStudentTestAccess({
      testStatus: studentTestStatus,
      accessState: availabilityResult.state,
      hasSubmitted,
      returnedAt: attempt?.returned_at || null,
      isLockedForGrading,
    })
    if (!accessState.can_start_or_continue && !accessState.can_view_submitted) {
      return NextResponse.json({ error: 'Test not found' }, { status: 404 })
    }
  }

  if (attemptTableMissing) {
    return NextResponse.json({ history: [], attemptId: null, migration_required: true })
  }

  if (!attempt) {
    return NextResponse.json({ history: [], attemptId: null })
  }

  const { data: history, error: historyError } = await supabase
    .from('test_attempt_history')
    .select('id, test_attempt_id, patch, snapshot, word_count, char_count, paste_word_count, keystroke_count, trigger, created_at')
    .eq('test_attempt_id', attempt.id)
    .order('created_at', { ascending: false })

  if (historyError) {
    console.error('Error fetching test attempt history:', historyError)
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 })
  }

  return NextResponse.json({ history: history || [], attemptId: attempt.id })
})

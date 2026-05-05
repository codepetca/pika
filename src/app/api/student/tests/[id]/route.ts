import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { getStudentTestStatus, summarizeQuizFocusEvents } from '@/lib/quizzes'
import {
  assertStudentCanAccessTest,
  getEffectiveStudentTestAccess,
  getTestStudentAvailabilityState,
  isMissingTestAttemptClosureColumnsError,
  isMissingTestAttemptReturnColumnsError,
} from '@/lib/server/tests'
import { normalizeTestResponses, type TestResponses } from '@/lib/test-attempts'
import { normalizeTestDocuments } from '@/lib/test-documents'
import { hasAnyMeaningfulTestResponse } from '@/lib/test-responses'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/student/tests/[id] - Get test with questions
export const GET = withErrorHandler('GetStudentTest', async (request, context) => {
  const user = await requireRole('student')
  const { id: testId } = await context.params

  const access = await assertStudentCanAccessTest(user.id, testId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const test = access.test
  const supabase = getServiceRoleClient()

  type AttemptRow = {
    responses: unknown
    is_submitted: boolean
    returned_at: string | null
    closed_for_grading_at: string | null
  }

  let attempt: AttemptRow | null = null
  let attemptError: { code?: string; message?: string; details?: string; hint?: string } | null = null

  {
    const attemptWithReturnResult = await supabase
      .from('test_attempts')
      .select('responses, is_submitted, returned_at, closed_for_grading_at')
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
      .select('responses, is_submitted')
      .eq('test_id', testId)
      .eq('student_id', user.id)
      .maybeSingle()

    attempt = (legacyAttemptResult.data
      ? {
          ...(legacyAttemptResult.data as { responses: unknown; is_submitted: boolean }),
          returned_at: null,
          closed_for_grading_at: null,
        }
      : null)
    attemptError = legacyAttemptResult.error
  }

  if (attemptError && attemptError.code !== 'PGRST205') {
    console.error('Error fetching student test attempt:', attemptError)
    return NextResponse.json({ error: 'Failed to fetch test progress' }, { status: 500 })
  }

  const draftResponses = normalizeTestResponses(attempt?.responses)

  const { data: responses, error: responsesError } = await supabase
    .from('test_responses')
    .select('selected_option, response_text')
    .eq('test_id', testId)
    .eq('student_id', user.id)

  if (responsesError) {
    console.error('Error checking submitted test responses:', responsesError)
    return NextResponse.json({ error: 'Failed to fetch test progress' }, { status: 500 })
  }

  const isLockedForGrading = Boolean(attempt?.closed_for_grading_at)
  const hasSubmitted = Boolean(attempt?.is_submitted) || (!isLockedForGrading && hasAnyMeaningfulTestResponse(responses))
  const availabilityResult = await getTestStudentAvailabilityState(supabase, testId, user.id)
  if (availabilityResult.error && !availabilityResult.missingTable) {
    console.error('Error fetching student test access:', availabilityResult.error)
    return NextResponse.json({ error: 'Failed to fetch test access' }, { status: 500 })
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
  if (!accessState.can_start_or_continue && !accessState.can_view_submitted) {
    return NextResponse.json({ error: 'Test not found' }, { status: 404 })
  }

  const { data: questions, error: questionsError } = await supabase
    .from('test_questions')
    .select('id, test_id, question_type, question_text, options, points, response_max_chars, response_monospace, position, created_at, updated_at')
    .eq('test_id', testId)
    .order('position', { ascending: true })

  if (questionsError) {
    console.error('Error fetching test questions:', questionsError)
    return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
  }

  const studentStatus =
    (hasSubmitted || isLockedForGrading) && attempt?.returned_at && accessState.effective_access === 'closed'
      ? 'can_view_results'
      : isLockedForGrading
        ? 'responded'
        : getStudentTestStatus(test, hasSubmitted, attempt?.returned_at)

  let studentResponses: TestResponses = draftResponses
  if (hasSubmitted || isLockedForGrading) {
    const { data: allResponses, error: allResponsesError } = await supabase
      .from('test_responses')
      .select('question_id, selected_option, response_text')
      .eq('test_id', testId)
      .eq('student_id', user.id)

    if (allResponsesError) {
      console.error('Error fetching submitted test responses:', allResponsesError)
      return NextResponse.json({ error: 'Failed to fetch test progress' }, { status: 500 })
    }

    const submittedResponses: TestResponses = {}
    for (const response of allResponses || []) {
      if (typeof response.selected_option === 'number') {
        submittedResponses[response.question_id] = {
          question_type: 'multiple_choice',
          selected_option: response.selected_option,
        }
        continue
      }
      if (typeof response.response_text === 'string') {
        submittedResponses[response.question_id] = {
          question_type: 'open_response',
          response_text: response.response_text,
        }
      }
    }
    if (Object.keys(submittedResponses).length > 0) {
      studentResponses = submittedResponses
    }
  }

  const { data: focusEvents } = await supabase
    .from('test_focus_events')
    .select('event_type, occurred_at')
    .eq('test_id', testId)
    .eq('student_id', user.id)
    .order('occurred_at', { ascending: true })

  return NextResponse.json({
    quiz: {
      id: test.id,
      classroom_id: test.classroom_id,
      title: test.title,
      assessment_type: 'test' as const,
      status: test.status,
      show_results: test.show_results,
      documents: normalizeTestDocuments(test.documents),
      position: test.position,
      student_status: studentStatus,
      returned_at: attempt?.returned_at || null,
      access_state: accessState.access_state,
      effective_access: accessState.effective_access,
      created_at: test.created_at,
      updated_at: test.updated_at,
    },
    questions: questions || [],
    student_status: studentStatus,
    student_responses: studentResponses,
    focus_summary: summarizeQuizFocusEvents(focusEvents || []),
  })
})

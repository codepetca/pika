import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { aggregateTestResults, canStudentViewTestResults } from '@/lib/tests'
import {
  assertStudentCanAccessTest,
  getEffectiveStudentTestAccess,
  getTestStudentAvailabilityState,
  isMissingTestAttemptClosureColumnsError,
  isMissingTestAttemptReturnColumnsError,
} from '@/lib/server/tests'
import { getClassroomStudentIds } from '@/lib/server/classrooms'
import { hasAnyMeaningfulTestResponse } from '@/lib/test-responses'
import { chunkValues, loadPagedRows } from '@/lib/server/query-chunks'
import { withErrorHandler } from '@/lib/api-handler'
import type { TestAssessmentQuestion, TestAssessmentResponse } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const STUDENT_TEST_RESULTS_PAGE_SIZE = 1000

type TestResultQuestionRow = {
  id: string
  question_type: string
  question_text: string
  options: string[]
  correct_option: number | null
  points: number | null
  response_max_chars: number | null
  response_monospace: boolean | null
  sample_solution: string | null
  position: number
}

type ReturnedAttemptRow = {
  student_id: string
  returned_at: string | null
}

type StudentTestResponseSummaryRow = {
  id: string
  selected_option: number | null
  response_text: string | null
}

type StudentTestResponseDetailRow = {
  id: string
  question_id: string
  selected_option: number | null
  response_text: string | null
  score: number | null
  feedback: string | null
  graded_at: string | null
}

type TestResponseResultRow = {
  id: string
  test_id: string
  question_id: string
  student_id: string
  selected_option: number | null
  response_text: string | null
  score: number | null
  feedback: string | null
  graded_at: string | null
  submitted_at: string
}

async function loadStudentTestResponseSummaries(
  supabase: any,
  testId: string,
  studentId: string
): Promise<{ rows: StudentTestResponseSummaryRow[]; error: any }> {
  return loadPagedRows<StudentTestResponseSummaryRow>(() =>
    supabase
      .from('test_responses')
      .select('id, selected_option, response_text')
      .eq('test_id', testId)
      .eq('student_id', studentId),
    STUDENT_TEST_RESULTS_PAGE_SIZE
  )
}

async function loadTestResultQuestions(
  supabase: any,
  testId: string
): Promise<{ rows: TestResultQuestionRow[]; error: any }> {
  return loadPagedRows<TestResultQuestionRow>(() =>
    supabase
      .from('test_questions')
      .select('id, question_type, question_text, options, correct_option, points, response_max_chars, response_monospace, sample_solution, position')
      .eq('test_id', testId),
    STUDENT_TEST_RESULTS_PAGE_SIZE,
    'position'
  )
}

async function loadReturnedTestAttemptsForStudents(
  supabase: any,
  testId: string,
  studentIds: string[]
): Promise<{ rows: ReturnedAttemptRow[]; error: any }> {
  if (studentIds.length === 0) return { rows: [], error: null }

  const rows: ReturnedAttemptRow[] = []
  for (const studentIdChunk of chunkValues(studentIds)) {
    const result = await loadPagedRows<ReturnedAttemptRow>(() =>
      supabase
        .from('test_attempts')
        .select('student_id, returned_at')
        .eq('test_id', testId)
        .in('student_id', studentIdChunk),
      STUDENT_TEST_RESULTS_PAGE_SIZE,
      'student_id'
    )

    if (result.error) return result
    rows.push(...result.rows)
  }

  return { rows, error: null }
}

async function loadStudentTestResponseDetails(
  supabase: any,
  testId: string,
  studentId: string
): Promise<{ rows: StudentTestResponseDetailRow[]; error: any }> {
  return loadPagedRows<StudentTestResponseDetailRow>(() =>
    supabase
      .from('test_responses')
      .select('id, question_id, selected_option, response_text, score, feedback, graded_at')
      .eq('test_id', testId)
      .eq('student_id', studentId),
    STUDENT_TEST_RESULTS_PAGE_SIZE
  )
}

async function loadReturnedTestResponsesForStudents(
  supabase: any,
  testId: string,
  studentIds: string[]
): Promise<{ rows: TestResponseResultRow[]; error: any }> {
  if (studentIds.length === 0) return { rows: [], error: null }

  const rows: TestResponseResultRow[] = []
  for (const studentIdChunk of chunkValues(studentIds)) {
    const result = await loadPagedRows<TestResponseResultRow>(() =>
      supabase
        .from('test_responses')
        .select('id, test_id, question_id, student_id, selected_option, response_text, score, feedback, graded_at, submitted_at')
        .eq('test_id', testId)
        .in('student_id', studentIdChunk),
      STUDENT_TEST_RESULTS_PAGE_SIZE
    )

    if (result.error) return result
    rows.push(...result.rows)
  }

  return { rows, error: null }
}

// GET /api/student/tests/[id]/results - Get aggregated results (if allowed)
export const GET = withErrorHandler('GetStudentTestResults', async (request, context) => {
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
    console.error('Error checking test attempt submission:', attemptError)
    return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
  }

  const {
    rows: studentResponses,
    error: studentResponsesError,
  } = await loadStudentTestResponseSummaries(supabase, testId, user.id)

  if (studentResponsesError) {
    console.error('Error checking student test responses:', studentResponsesError)
    return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
  }

  const isLockedForGrading = Boolean(attempt?.closed_for_grading_at)
  const hasResponded = Boolean(attempt?.is_submitted) || (!isLockedForGrading && hasAnyMeaningfulTestResponse(studentResponses))
  const availabilityResult = await getTestStudentAvailabilityState(supabase, testId, user.id)
  if (availabilityResult.error && !availabilityResult.missingTable) {
    console.error('Error fetching student test access for results:', availabilityResult.error)
    return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
  }
  const accessState = getEffectiveStudentTestAccess({
    testStatus: test.status,
    accessState: availabilityResult.state,
    hasSubmitted: hasResponded,
    returnedAt: attempt?.returned_at || null,
    isLockedForGrading,
  })
  const canViewReturnedSelectedStudentResults =
    (hasResponded || isLockedForGrading) && Boolean(attempt?.returned_at) && accessState.effective_access === 'closed'

  if (!canViewReturnedSelectedStudentResults && !canStudentViewTestResults(test, hasResponded, attempt?.returned_at)) {
    return NextResponse.json(
      { error: 'Results are available after your teacher returns this test' },
      { status: 403 }
    )
  }

  const { rows: questions, error: questionsError } = await loadTestResultQuestions(supabase, testId)

  if (questionsError) {
    console.error('Error fetching test questions:', questionsError)
    return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
  }

  const classroomStudentsResult = await getClassroomStudentIds(supabase, test.classroom_id)
  if (classroomStudentsResult.error) {
    console.error('Error fetching classroom enrollments for test results:', classroomStudentsResult.error)
    return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
  }

  let returnedStudentIds: string[] = []
  if (classroomStudentsResult.studentIds.length > 0) {
    const {
      rows: returnedAttempts,
      error: returnedAttemptsError,
    } = await loadReturnedTestAttemptsForStudents(
      supabase,
      testId,
      classroomStudentsResult.studentIds
    )

    if (returnedAttemptsError) {
      console.error('Error fetching returned test attempts:', returnedAttemptsError)
      return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
    }

    returnedStudentIds = Array.from(
      new Set(
        (returnedAttempts || [])
          .filter((attempt) => attempt.returned_at)
          .map((attempt) => attempt.student_id)
          .filter((studentId): studentId is string =>
            typeof studentId === 'string' &&
            classroomStudentsResult.studentIdSet.has(studentId)
          )
      )
    )
  }

  const { rows: responses, error: responsesError } = await loadReturnedTestResponsesForStudents(
    supabase,
    testId,
    returnedStudentIds
  )

  if (responsesError) {
    console.error('Error fetching test responses:', responsesError)
    return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
  }

  const returnedStudentIdSet = new Set(returnedStudentIds)
  const returnedResponses = (responses || []).filter((response) =>
    returnedStudentIdSet.has(response.student_id)
  )

  const multipleChoiceQuestions = (questions || []).filter(
    (question) => question.question_type !== 'open_response'
  )
  const multipleChoiceResponses = returnedResponses.flatMap((response) => {
    if (typeof response.selected_option !== 'number') return []
    return [{
      id: response.id,
      quiz_id: testId,
      question_id: response.question_id,
      student_id: response.student_id,
      selected_option: response.selected_option,
      submitted_at: response.submitted_at,
    } satisfies TestAssessmentResponse]
  })

  const aggregated = aggregateTestResults(
    multipleChoiceQuestions as TestAssessmentQuestion[],
    multipleChoiceResponses
  )

  const myResponses: Record<string, number> = {}
  const { rows: myResponsesData, error: myResponsesError } = await loadStudentTestResponseDetails(
    supabase,
    testId,
    user.id
  )

  if (myResponsesError) {
    console.error('Error fetching student test responses:', myResponsesError)
    return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
  }

  const responseByQuestion = new Map(
    (myResponsesData || []).map((response) => [response.question_id, response])
  )
  for (const response of myResponsesData || []) {
    if (typeof response.selected_option === 'number') {
      myResponses[response.question_id] = response.selected_option
    }
  }

  const questionResults = (questions || []).map((question) => {
    const response = responseByQuestion.get(question.id)
    const score = typeof response?.score === 'number' ? response.score : null
    return {
      question_id: question.id,
      question_type: question.question_type === 'open_response' ? 'open_response' : 'multiple_choice',
      question_text: question.question_text,
      options: question.options,
      points: Number(question.points ?? 0),
      response_max_chars: Number(question.response_max_chars ?? 5000),
      response_monospace: question.response_monospace === true,
      sample_solution:
        question.question_type === 'open_response' &&
        question.response_monospace === true &&
        typeof question.sample_solution === 'string' &&
        question.sample_solution.trim().length > 0
          ? question.sample_solution.trim()
          : null,
      correct_option: question.correct_option,
      selected_option: response?.selected_option ?? null,
      response_text: response?.response_text ?? null,
      score,
      feedback: response?.feedback ?? null,
      graded_at: response?.graded_at ?? null,
      is_correct:
        question.question_type === 'open_response'
          ? null
          : typeof response?.selected_option === 'number' &&
            typeof question.correct_option === 'number' &&
            response.selected_option === question.correct_option,
    }
  })

  const possiblePoints = questionResults.reduce((acc, question) => acc + question.points, 0)
  const earnedPoints = questionResults.reduce((acc, question) => acc + (question.score ?? 0), 0)
  const percent = possiblePoints > 0 ? (earnedPoints / possiblePoints) * 100 : 0

  const responseTest = {
    id: test.id,
    title: test.title,
    status: test.status,
    returned_at: attempt?.returned_at || null,
    access_state: accessState.access_state,
    effective_access: accessState.effective_access,
  }

  return NextResponse.json({
    test: responseTest,
    results: aggregated,
    my_responses: myResponses,
    question_results: questionResults,
    summary: {
      earned_points: earnedPoints,
      possible_points: possiblePoints,
      percent,
    },
  })
})

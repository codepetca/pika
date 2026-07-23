import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { aggregateTestResults, summarizeTestFocusEvents } from '@/lib/tests'
import {
  assertTeacherOwnsTest,
  getEffectiveStudentTestAccess,
  isMissingTestAttemptClosureColumnsError,
  isMissingTestAttemptReturnColumnsError,
  isMissingTestStudentAvailabilityError,
} from '@/lib/server/tests'
import { getClassroomStudentIds } from '@/lib/server/classrooms'
import { loadChunkedRows } from '@/lib/server/query-chunks'
import { getActiveTestAiGradingRunSummary } from '@/lib/server/test-ai-grading-runs'
import { normalizeTestResponses } from '@/lib/test-attempts'
import type {
  TestAssessmentQuestion,
  TestAssessmentResponse,
  TestFocusSummary,
  TestStudentAvailabilityState,
} from '@/types'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const TEST_RESULTS_PAGE_SIZE = 1000

type TestResponseResultRow = {
  id: string
  revision: number
  test_id: string
  question_id: string
  student_id: string
  selected_option: number | null
  response_text: string | null
  score: number | null
  feedback: string | null
  graded_at: string | null
  graded_by: string | null
  submitted_at: string
}

type TestAttemptResultRow = {
  student_id: string
  is_submitted: boolean
  submitted_at: string | null
  returned_at: string | null
  returned_by: string | null
  closed_for_grading_at: string | null
  closed_for_grading_by: string | null
  updated_at: string
  responses: unknown
}

type UserResultRow = {
  id: string
  email: string
}

type StudentProfileResultRow = {
  user_id: string
  first_name: string | null
  last_name: string | null
}

type FocusEventResultRow = {
  student_id: string
  event_type: any
  occurred_at: string
}

type AvailabilityResultRow = {
  student_id: string
  state: unknown
}

function isMissingAvailabilityTableError(error: any): boolean {
  return (
    isMissingTestStudentAvailabilityError(error) ||
    `${error?.message || error || ''}`.includes('Unexpected table: test_student_availability')
  )
}

async function loadStudentScopedRows<T>(
  supabase: any,
  table: string,
  select: string,
  testId: string,
  studentIds: string[],
): Promise<{ rows: T[]; error: any }> {
  return loadChunkedRows<T>({
    supabase,
    table,
    select,
    filters: [
      { column: 'test_id', values: [testId] },
      { column: 'student_id', values: studentIds },
    ],
    pageSize: TEST_RESULTS_PAGE_SIZE,
  })
}

async function loadTestResponses(
  supabase: any,
  testId: string,
  studentIds: string[],
): Promise<{ rows: TestResponseResultRow[]; error: any }> {
  return loadStudentScopedRows<TestResponseResultRow>(
    supabase,
    'test_responses',
    'id, revision, test_id, question_id, student_id, selected_option, response_text, score, feedback, graded_at, graded_by, submitted_at',
    testId,
    studentIds,
  )
}

async function loadTestAttempts(
  supabase: any,
  testId: string,
  studentIds: string[],
): Promise<{ rows: TestAttemptResultRow[]; error: any }> {
  async function loadAttemptsWithoutReturnOrClosure() {
    const legacyResult = await loadStudentScopedRows<{
      student_id: string
      is_submitted: boolean
      submitted_at: string | null
      updated_at: string
      responses: unknown
    }>(
      supabase,
      'test_attempts',
      'id, student_id, is_submitted, submitted_at, updated_at, responses',
      testId,
      studentIds,
    )

    return {
      rows: legacyResult.rows.map((attempt) => ({
        ...attempt,
        returned_at: null,
        returned_by: null,
        closed_for_grading_at: null,
        closed_for_grading_by: null,
      })),
      error: legacyResult.error,
    }
  }

  const primaryResult = await loadStudentScopedRows<TestAttemptResultRow>(
    supabase,
    'test_attempts',
    'id, student_id, is_submitted, submitted_at, returned_at, returned_by, closed_for_grading_at, closed_for_grading_by, updated_at, responses',
    testId,
    studentIds,
  )
  let attempts = primaryResult.rows
  let attemptsError = primaryResult.error

  if (attemptsError && isMissingTestAttemptReturnColumnsError(attemptsError)) {
    const legacyResult = await loadAttemptsWithoutReturnOrClosure()
    attempts = legacyResult.rows
    attemptsError = legacyResult.error
  }

  if (attemptsError && isMissingTestAttemptClosureColumnsError(attemptsError)) {
    const legacyResult = await loadStudentScopedRows<{
      student_id: string
      is_submitted: boolean
      submitted_at: string | null
      returned_at: string | null
      returned_by: string | null
      updated_at: string
      responses: unknown
    }>(
      supabase,
      'test_attempts',
      'id, student_id, is_submitted, submitted_at, returned_at, returned_by, updated_at, responses',
      testId,
      studentIds,
    )

    attempts = legacyResult.rows.map((attempt) => ({
      ...attempt,
      closed_for_grading_at: null,
      closed_for_grading_by: null,
    }))
    attemptsError = legacyResult.error

    if (attemptsError && isMissingTestAttemptReturnColumnsError(attemptsError)) {
      const baseLegacyResult = await loadAttemptsWithoutReturnOrClosure()
      attempts = baseLegacyResult.rows
      attemptsError = baseLegacyResult.error
    }
  }

  return { rows: attempts || [], error: attemptsError }
}

async function loadUsers(
  supabase: any,
  studentIds: string[],
): Promise<{ rows: UserResultRow[]; error: any }> {
  return loadChunkedRows<UserResultRow>({
    supabase,
    table: 'users',
    select: 'id, email',
    filters: [{ column: 'id', values: studentIds }],
    pageSize: TEST_RESULTS_PAGE_SIZE,
  })
}

async function loadStudentProfiles(
  supabase: any,
  studentIds: string[],
): Promise<{ rows: StudentProfileResultRow[]; error: any }> {
  return loadChunkedRows<StudentProfileResultRow>({
    supabase,
    table: 'student_profiles',
    select: 'id, user_id, first_name, last_name',
    filters: [{ column: 'user_id', values: studentIds }],
    pageSize: TEST_RESULTS_PAGE_SIZE,
  })
}

async function loadFocusEvents(
  supabase: any,
  testId: string,
  studentIds: string[],
): Promise<{ rows: FocusEventResultRow[]; error: any }> {
  return loadStudentScopedRows<FocusEventResultRow>(
    supabase,
    'test_focus_events',
    'id, student_id, event_type, occurred_at',
    testId,
    studentIds,
  )
}

async function loadStudentAvailabilityMap(
  supabase: any,
  testId: string,
  studentIds: string[],
): Promise<{
  stateByStudentId: Map<string, TestStudentAvailabilityState>
  missingTable: boolean
  error: any
}> {
  const stateByStudentId = new Map<string, TestStudentAvailabilityState>()
  if (studentIds.length === 0) {
    return { stateByStudentId, missingTable: false, error: null }
  }

  let result: { rows: AvailabilityResultRow[]; error: any }
  try {
    result = await loadStudentScopedRows<AvailabilityResultRow>(
      supabase,
      'test_student_availability',
      'id, student_id, state',
      testId,
      studentIds,
    )
  } catch (error) {
    return {
      stateByStudentId,
      missingTable: isMissingAvailabilityTableError(error),
      error,
    }
  }

  if (result.error) {
    return {
      stateByStudentId,
      missingTable: isMissingAvailabilityTableError(result.error),
      error: result.error,
    }
  }

  for (const row of result.rows || []) {
    if (row.state === 'open' || row.state === 'closed') {
      stateByStudentId.set(row.student_id, row.state)
    }
  }

  return { stateByStudentId, missingTable: false, error: null }
}

// GET /api/teacher/tests/[id]/results - Get aggregated results
export const GET = withErrorHandler('GetTeacherTestResults', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: testId } = await context.params

  const access = await assertTeacherOwnsTest(user.id, testId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const test = access.test
  const supabase = getServiceRoleClient()
  const activeAiGradingRun = await getActiveTestAiGradingRunSummary(testId)

  const { data: questions, error: questionsError } = await supabase
    .from('test_questions')
    .select('*')
    .eq('test_id', testId)
    .order('position', { ascending: true })

  if (questionsError) {
    console.error('Error fetching test questions:', questionsError)
    return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
  }

  const classroomStudentsResult = await getClassroomStudentIds(supabase, test.classroom_id)
  if (classroomStudentsResult.error) {
    console.error('Error fetching classroom enrollments:', classroomStudentsResult.error)
    return NextResponse.json({ error: 'Failed to fetch enrollments' }, { status: 500 })
  }

  const classroomStudentIds = classroomStudentsResult.studentIds
  const classroomStudentIdSet = classroomStudentsResult.studentIdSet
  const { rows: responses, error: responsesError } =
    classroomStudentIds.length > 0
      ? await loadTestResponses(supabase, testId, classroomStudentIds)
      : { rows: [], error: null }

  if (responsesError) {
    console.error('Error fetching test responses:', responsesError)
    return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
  }

  const enrolledResponses = (responses || []).filter((response) =>
    classroomStudentIdSet.has(response.student_id)
  ).sort((a, b) => a.id.localeCompare(b.id))
  const availabilityResult = await loadStudentAvailabilityMap(supabase, testId, classroomStudentIds)
  if (availabilityResult.error && !availabilityResult.missingTable) {
    console.error('Error fetching test student availability:', availabilityResult.error)
    return NextResponse.json({ error: 'Failed to fetch student access' }, { status: 500 })
  }
  const availabilityByStudent = availabilityResult.stateByStudentId
  const questionById = new Map((questions || []).map((question) => [question.id, question]))
  const testPointsPossible = (questions || []).reduce(
    (sum, question) => sum + Number(question.points || 0),
    0
  )

  const studentAnswers: Record<string, Record<string, {
    response_id: string | null
    response_revision: number | null
    question_type: 'multiple_choice' | 'open_response'
    selected_option: number | null
    response_text: string | null
    score: number | null
    feedback: string | null
    graded_at: string | null
    is_draft: boolean
  }>> = {}
  const pointsEarnedByStudent = new Map<string, number>()
  const submittedAtByStudent = new Map<string, string>()
  const openGradedCounts = new Map<string, number>()
  const openUngradedCounts = new Map<string, number>()

  for (const response of enrolledResponses) {
    const question = questionById.get(response.question_id)
    if (!question) continue
    if (!studentAnswers[response.student_id]) studentAnswers[response.student_id] = {}
    studentAnswers[response.student_id][response.question_id] = {
      response_id: response.id,
      response_revision: response.revision,
      question_type: question.question_type === 'open_response' ? 'open_response' : 'multiple_choice',
      selected_option: response.selected_option,
      response_text: response.response_text,
      score: response.score,
      feedback: response.feedback,
      graded_at: response.graded_at,
      is_draft: false,
    }
    if (typeof response.score === 'number') {
      pointsEarnedByStudent.set(
        response.student_id,
        (pointsEarnedByStudent.get(response.student_id) || 0) + response.score
      )
    }
    const previousSubmittedAt = submittedAtByStudent.get(response.student_id)
    if (!previousSubmittedAt || new Date(response.submitted_at).getTime() > new Date(previousSubmittedAt).getTime()) {
      submittedAtByStudent.set(response.student_id, response.submitted_at)
    }

    if (question.question_type === 'open_response') {
      const hasScore = typeof response.score === 'number'
      if (hasScore) {
        openGradedCounts.set(response.student_id, (openGradedCounts.get(response.student_id) || 0) + 1)
      } else {
        openUngradedCounts.set(response.student_id, (openUngradedCounts.get(response.student_id) || 0) + 1)
      }
    }
  }

  const attemptByStudent = new Map<
    string,
    {
      is_submitted: boolean
      submitted_at: string | null
      returned_at: string | null
      returned_by: string | null
      closed_for_grading_at: string | null
      closed_for_grading_by: string | null
      updated_at: string
      responses: unknown
    }
  >()
  if (classroomStudentIds.length > 0) {
    const { rows: attempts, error: attemptsError } = await loadTestAttempts(supabase, testId, classroomStudentIds)

    if (attemptsError && attemptsError.code !== 'PGRST205') {
      console.error('Error fetching test attempts:', attemptsError)
      return NextResponse.json({ error: 'Failed to fetch attempts' }, { status: 500 })
    }

    for (const attempt of attempts || []) {
      attemptByStudent.set(attempt.student_id, {
        is_submitted: !!attempt.is_submitted,
        submitted_at: attempt.submitted_at,
        returned_at: attempt.returned_at,
        returned_by: attempt.returned_by,
        closed_for_grading_at: attempt.closed_for_grading_at,
        closed_for_grading_by: attempt.closed_for_grading_by,
        updated_at: attempt.updated_at,
        responses: attempt.responses,
      })
    }
  }

  const userById = new Map<
    string,
    { email: string; first_name: string | null; last_name: string | null; name: string | null }
  >()
  if (classroomStudentIds.length > 0) {
    const { rows: users, error: usersError } = await loadUsers(supabase, classroomStudentIds)
    if (usersError) {
      console.error('Error fetching test result users:', usersError)
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
    }

    const { rows: profiles, error: profilesError } = await loadStudentProfiles(supabase, classroomStudentIds)
    if (profilesError) {
      console.error('Error fetching test result student profiles:', profilesError)
      return NextResponse.json({ error: 'Failed to fetch student profiles' }, { status: 500 })
    }

    const profileMap = new Map(
      (profiles || []).map((profile) => [profile.user_id, profile])
    )
    for (const userRow of users || []) {
      const profile = profileMap.get(userRow.id)
      const firstName = (profile?.first_name || '').trim() || null
      const lastName = (profile?.last_name || '').trim() || null
      userById.set(userRow.id, {
        email: userRow.email,
        first_name: firstName,
        last_name: lastName,
        name: `${firstName || ''} ${lastName || ''}`.trim() || null,
      })
    }
  }

  const focusSummaryByStudent = new Map<string, TestFocusSummary>()
  if (classroomStudentIds.length > 0) {
    const { rows: focusEvents, error: focusEventsError } = await loadFocusEvents(supabase, testId, classroomStudentIds)
    if (focusEventsError) {
      console.error('Error fetching test focus events:', focusEventsError)
      return NextResponse.json({ error: 'Failed to fetch focus events' }, { status: 500 })
    }

    const grouped = new Map<string, Array<{ event_type: any; occurred_at: string }>>()
    for (const row of focusEvents || []) {
      const current = grouped.get(row.student_id) || []
      current.push({ event_type: row.event_type, occurred_at: row.occurred_at })
      grouped.set(row.student_id, current)
    }

    for (const [studentId, events] of grouped) {
      focusSummaryByStudent.set(studentId, summarizeTestFocusEvents(events))
    }
  }

  const students = classroomStudentIds.map((studentId) => {
    const userInfo = userById.get(studentId)
    const attempt = attemptByStudent.get(studentId)
    const submittedAnswers = studentAnswers[studentId] || {}
    const hasSubmittedAnswers = Object.keys(submittedAnswers).length > 0
    const isClosedForGrading = !!attempt?.closed_for_grading_at
    const isSubmitted = !!attempt?.is_submitted || (hasSubmittedAnswers && !attempt)
    const isReturned = !!attempt?.returned_at
    const status: 'not_started' | 'in_progress' | 'closed' | 'submitted' | 'returned' = isReturned
      ? 'returned'
      : isSubmitted
      ? 'submitted'
      : isClosedForGrading
      ? 'closed'
      : attempt
      ? 'in_progress'
      : 'not_started'

    // If the student has not submitted or been locked for grading, expose draft attempt answers for monitoring.
    let answersForStudent = submittedAnswers
    if (!isSubmitted && !isClosedForGrading && attempt) {
      const normalizedDraft = normalizeTestResponses(attempt.responses)
      const draftAnswers: Record<string, {
        response_id: string | null
        response_revision: number | null
        question_type: 'multiple_choice' | 'open_response'
        selected_option: number | null
        response_text: string | null
        score: number | null
        feedback: string | null
        graded_at: string | null
        is_draft: boolean
      }> = {}

      for (const question of questions || []) {
        const response = normalizedDraft[question.id]
        if (!response) continue
        if (response.question_type === 'multiple_choice') {
          draftAnswers[question.id] = {
            response_id: null,
            response_revision: null,
            question_type: 'multiple_choice',
            selected_option: response.selected_option,
            response_text: null,
            score: null,
            feedback: null,
            graded_at: null,
            is_draft: true,
          }
          continue
        }

        draftAnswers[question.id] = {
          response_id: null,
          response_revision: null,
          question_type: 'open_response',
          selected_option: null,
          response_text: response.response_text,
          score: null,
          feedback: null,
          graded_at: null,
          is_draft: true,
        }
      }

      answersForStudent = draftAnswers
    }

    const submittedAt = attempt?.submitted_at || submittedAtByStudent.get(studentId) || null
    const lastActivityAt = attempt?.updated_at || submittedAt || null
    const pointsEarned = pointsEarnedByStudent.get(studentId) || 0
    const percent = status === 'not_started' || testPointsPossible <= 0
      ? null
      : (pointsEarned / testPointsPossible) * 100
    const effectiveAccess = getEffectiveStudentTestAccess({
      testStatus: test.status,
      accessState: availabilityByStudent.get(studentId) ?? null,
      hasSubmitted: isSubmitted,
      returnedAt: attempt?.returned_at || null,
      isLockedForGrading: isClosedForGrading,
    })

    return {
      student_id: studentId,
      name: userInfo?.name || null,
      first_name: userInfo?.first_name || null,
      last_name: userInfo?.last_name || null,
      email: userInfo?.email || '',
      status,
      submitted_at: submittedAt,
      returned_at: attempt?.returned_at || null,
      returned_by: attempt?.returned_by || null,
      closed_for_grading_at: attempt?.closed_for_grading_at || null,
      closed_for_grading_by: attempt?.closed_for_grading_by || null,
      last_activity_at: lastActivityAt,
      points_earned: pointsEarned,
      points_possible: testPointsPossible,
      percent,
      graded_open_responses: openGradedCounts.get(studentId) || 0,
      ungraded_open_responses: openUngradedCounts.get(studentId) || 0,
      access_state: effectiveAccess.access_state,
      effective_access: effectiveAccess.effective_access,
      access_source: effectiveAccess.access_source,
      answers: answersForStudent,
      focus_summary: focusSummaryByStudent.get(studentId) || null,
    }
  })

  students.sort((a, b) => {
    const left = a.name || a.email
    const right = b.name || b.email
    return left.localeCompare(right) || a.student_id.localeCompare(b.student_id)
  })

  const responders = students
    .filter((student) => student.status === 'submitted')
    .map((student) => ({
      student_id: student.student_id,
      name: student.name,
      email: student.email,
      answers: student.answers,
      focus_summary: student.focus_summary,
    }))

  const multipleChoiceQuestions = (questions || []).filter(
    (question) => question.question_type !== 'open_response'
  )
  const multipleChoiceResponses = enrolledResponses.flatMap((response) => {
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

  const aggregateQuestions: TestAssessmentQuestion[] = multipleChoiceQuestions.map((question) => ({
    ...question,
    quiz_id: question.test_id,
  }))
  const aggregated = aggregateTestResults(aggregateQuestions, multipleChoiceResponses)

  const openQuestionIds = new Set(
    (questions || [])
      .filter((question) => question.question_type === 'open_response')
      .map((question) => question.id)
  )

  let gradedOpenResponses = 0
  let ungradedOpenResponses = 0
  for (const response of enrolledResponses) {
    if (!openQuestionIds.has(response.question_id)) continue
    const hasScore = typeof response.score === 'number'
    if (hasScore) {
      gradedOpenResponses += 1
    } else {
      ungradedOpenResponses += 1
    }
  }

  const responseTest = {
    id: test.id,
    title: test.title,
    assessment_type: 'test' as const,
    status: test.status,
    show_results: test.show_results,
  }

  return NextResponse.json({
    test: responseTest,
    questions: (questions || []).map((q) => ({
      id: q.id,
      question_type: q.question_type === 'open_response' ? 'open_response' : 'multiple_choice',
      question_text: q.question_text,
      options: q.options,
      correct_option: q.correct_option,
      points: q.points,
      response_max_chars: q.response_max_chars,
      response_monospace: q.response_monospace === true,
      position: q.position,
    })),
    results: aggregated,
    students,
    responders,
    stats: {
      total_students: classroomStudentsResult.totalStudents,
      responded: responders.length,
      open_questions_count: openQuestionIds.size,
      graded_open_responses: gradedOpenResponses,
      ungraded_open_responses: ungradedOpenResponses,
      returned_count: students.filter((student) => student.returned_at !== null).length,
    },
    active_ai_grading_run: activeAiGradingRun,
  })
})

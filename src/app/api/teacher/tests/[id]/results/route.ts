import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { aggregateResults, summarizeQuizFocusEvents } from '@/lib/quizzes'
import {
  assertTeacherOwnsTest,
  isMissingTestAttemptReturnColumnsError,
  isMissingTestResponseAiColumnsError,
} from '@/lib/server/tests'
import type { QuizFocusSummary, QuizQuestion, QuizResponse } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/teacher/tests/[id]/results - Get aggregated results
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id: testId } = await params

    const access = await assertTeacherOwnsTest(user.id, testId)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    const test = access.test
    const supabase = getServiceRoleClient()

    const { data: questions, error: questionsError } = await supabase
      .from('test_questions')
      .select('*')
      .eq('test_id', testId)
      .order('position', { ascending: true })

    if (questionsError) {
      console.error('Error fetching test questions:', questionsError)
      return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
    }

    let responses:
      | Array<{
          id: string
          test_id: string
          question_id: string
          student_id: string
          selected_option: number | null
          response_text: string | null
          score: number | null
          feedback: string | null
          graded_at: string | null
          graded_by: string | null
          ai_grading_basis: string | null
          ai_reference_answers: unknown
          ai_model: string | null
          submitted_at: string
        }>
      | null = null
    let responsesError: { code?: string; message?: string; details?: string; hint?: string } | null = null

    {
      const responsesWithAiResult = await supabase
        .from('test_responses')
        .select('id, test_id, question_id, student_id, selected_option, response_text, score, feedback, graded_at, graded_by, ai_grading_basis, ai_reference_answers, ai_model, submitted_at')
        .eq('test_id', testId)

      responses = (responsesWithAiResult.data as typeof responses) || null
      responsesError = responsesWithAiResult.error
    }

    if (responsesError && isMissingTestResponseAiColumnsError(responsesError)) {
      const legacyResponsesResult = await supabase
        .from('test_responses')
        .select('id, test_id, question_id, student_id, selected_option, response_text, score, feedback, graded_at, graded_by, submitted_at')
        .eq('test_id', testId)

      responses =
        ((legacyResponsesResult.data as Array<{
          id: string
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
        }> | null) || []).map((response) => ({
          ...response,
          ai_grading_basis: null,
          ai_reference_answers: null,
          ai_model: null,
        }))
      responsesError = legacyResponsesResult.error
    }

    if (responsesError) {
      console.error('Error fetching test responses:', responsesError)
      return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
    }

    const { data: enrollments, error: enrollmentsError } = await supabase
      .from('classroom_enrollments')
      .select('student_id')
      .eq('classroom_id', test.classroom_id)

    if (enrollmentsError) {
      console.error('Error fetching classroom enrollments:', enrollmentsError)
      return NextResponse.json({ error: 'Failed to fetch enrollments' }, { status: 500 })
    }

    const classroomStudentIds = [...new Set((enrollments || []).map((row) => row.student_id))]
    const questionById = new Map((questions || []).map((question) => [question.id, question]))
    const testPointsPossible = (questions || []).reduce(
      (sum, question) => sum + Number(question.points || 0),
      0
    )

    const studentAnswers: Record<string, Record<string, {
      response_id: string
      question_type: 'multiple_choice' | 'open_response'
      selected_option: number | null
      response_text: string | null
      score: number | null
      feedback: string | null
      graded_at: string | null
      ai_grading_basis: 'teacher_key' | 'generated_reference' | null
      ai_reference_answers: string[] | null
      ai_model: string | null
    }>> = {}
    const pointsEarnedByStudent = new Map<string, number>()
    const submittedAtByStudent = new Map<string, string>()
    const openGradedCounts = new Map<string, number>()
    const openUngradedCounts = new Map<string, number>()

    for (const response of responses || []) {
      const question = questionById.get(response.question_id)
      if (!question) continue
      if (!studentAnswers[response.student_id]) studentAnswers[response.student_id] = {}
      studentAnswers[response.student_id][response.question_id] = {
        response_id: response.id,
        question_type: question.question_type === 'open_response' ? 'open_response' : 'multiple_choice',
        selected_option: response.selected_option,
        response_text: response.response_text,
        score: response.score,
        feedback: response.feedback,
        graded_at: response.graded_at,
        ai_grading_basis:
          response.ai_grading_basis === 'teacher_key' || response.ai_grading_basis === 'generated_reference'
            ? response.ai_grading_basis
            : null,
        ai_reference_answers: Array.isArray(response.ai_reference_answers)
          ? response.ai_reference_answers
              .map((value) => (typeof value === 'string' ? value : ''))
              .filter((value) => value.length > 0)
          : null,
        ai_model: typeof response.ai_model === 'string' ? response.ai_model : null,
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
        const hasFeedback = typeof response.feedback === 'string' && response.feedback.trim().length > 0
        if (hasScore && hasFeedback) {
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
        updated_at: string
      }
    >()
    if (classroomStudentIds.length > 0) {
      let attempts:
        | Array<{
            student_id: string
            is_submitted: boolean
            submitted_at: string | null
            returned_at: string | null
            returned_by: string | null
            updated_at: string
          }>
        | null = null
      let attemptsError: { code?: string; message?: string; details?: string; hint?: string } | null = null

      {
        const attemptsWithReturnResult = await supabase
          .from('test_attempts')
          .select('student_id, is_submitted, submitted_at, returned_at, returned_by, updated_at')
          .eq('test_id', testId)
          .in('student_id', classroomStudentIds)

        attempts = (attemptsWithReturnResult.data as typeof attempts) || null
        attemptsError = attemptsWithReturnResult.error
      }

      if (attemptsError && isMissingTestAttemptReturnColumnsError(attemptsError)) {
        const legacyAttemptsResult = await supabase
          .from('test_attempts')
          .select('student_id, is_submitted, submitted_at, updated_at')
          .eq('test_id', testId)
          .in('student_id', classroomStudentIds)

        attempts =
          ((legacyAttemptsResult.data as Array<{
            student_id: string
            is_submitted: boolean
            submitted_at: string | null
            updated_at: string
          }> | null) || []).map((attempt) => ({
            ...attempt,
            returned_at: null,
            returned_by: null,
          }))
        attemptsError = legacyAttemptsResult.error
      }

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
          updated_at: attempt.updated_at,
        })
      }
    }

    const userById = new Map<string, { email: string; name: string | null }>()
    if (classroomStudentIds.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('id, email')
        .in('id', classroomStudentIds)
      const { data: profiles } = await supabase
        .from('student_profiles')
        .select('user_id, first_name, last_name')
        .in('user_id', classroomStudentIds)
      const profileMap = new Map(
        (profiles || []).map((profile) => [
          profile.user_id,
          `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || null,
        ])
      )
      for (const userRow of users || []) {
        userById.set(userRow.id, {
          email: userRow.email,
          name: profileMap.get(userRow.id) || null,
        })
      }
    }

    const focusSummaryByStudent = new Map<string, QuizFocusSummary>()
    if (classroomStudentIds.length > 0) {
      const { data: focusEvents } = await supabase
        .from('test_focus_events')
        .select('student_id, event_type, occurred_at')
        .eq('test_id', testId)
        .in('student_id', classroomStudentIds)
        .order('occurred_at', { ascending: true })

      const grouped = new Map<string, Array<{ event_type: any; occurred_at: string }>>()
      for (const row of focusEvents || []) {
        const current = grouped.get(row.student_id) || []
        current.push({ event_type: row.event_type, occurred_at: row.occurred_at })
        grouped.set(row.student_id, current)
      }

      for (const [studentId, events] of grouped) {
        focusSummaryByStudent.set(studentId, summarizeQuizFocusEvents(events))
      }
    }

    const students = classroomStudentIds.map((studentId) => {
      const userInfo = userById.get(studentId)
      const attempt = attemptByStudent.get(studentId)
      const hasAnswers = !!studentAnswers[studentId] && Object.keys(studentAnswers[studentId]).length > 0
      const isSubmitted = !!attempt?.is_submitted || hasAnswers
      const isReturned = !!attempt?.returned_at
      const status: 'not_started' | 'in_progress' | 'submitted' | 'returned' = isReturned
        ? 'returned'
        : isSubmitted
        ? 'submitted'
        : attempt
        ? 'in_progress'
        : 'not_started'
      const submittedAt = attempt?.submitted_at || submittedAtByStudent.get(studentId) || null
      const lastActivityAt = attempt?.updated_at || submittedAt || null
      const pointsEarned = pointsEarnedByStudent.get(studentId) || 0
      const percent = status === 'not_started' || testPointsPossible <= 0
        ? null
        : (pointsEarned / testPointsPossible) * 100

      return {
        student_id: studentId,
        name: userInfo?.name || null,
        email: userInfo?.email || '',
        status,
        submitted_at: submittedAt,
        returned_at: attempt?.returned_at || null,
        returned_by: attempt?.returned_by || null,
        last_activity_at: lastActivityAt,
        points_earned: pointsEarned,
        points_possible: testPointsPossible,
        percent,
        graded_open_responses: openGradedCounts.get(studentId) || 0,
        ungraded_open_responses: openUngradedCounts.get(studentId) || 0,
        answers: studentAnswers[studentId] || {},
        focus_summary: focusSummaryByStudent.get(studentId) || null,
      }
    })

    students.sort((a, b) => {
      const left = a.name || a.email
      const right = b.name || b.email
      return left.localeCompare(right)
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
    const multipleChoiceResponses = (responses || []).flatMap((response) => {
      if (typeof response.selected_option !== 'number') return []
      return [{
        id: response.id,
        quiz_id: testId,
        question_id: response.question_id,
        student_id: response.student_id,
        selected_option: response.selected_option,
        submitted_at: response.submitted_at,
      } satisfies QuizResponse]
    })

    const aggregated = aggregateResults(
      multipleChoiceQuestions as QuizQuestion[],
      multipleChoiceResponses
    )

    const openQuestionIds = new Set(
      (questions || [])
        .filter((question) => question.question_type === 'open_response')
        .map((question) => question.id)
    )

    let gradedOpenResponses = 0
    let ungradedOpenResponses = 0
    for (const response of responses || []) {
      if (!openQuestionIds.has(response.question_id)) continue
      const hasScore = typeof response.score === 'number'
      const hasFeedback = typeof response.feedback === 'string' && response.feedback.trim().length > 0
      if (hasScore && hasFeedback) {
        gradedOpenResponses += 1
      } else {
        ungradedOpenResponses += 1
      }
    }

    return NextResponse.json({
      quiz: {
        id: test.id,
        title: test.title,
        assessment_type: 'test' as const,
        status: test.status,
        show_results: test.show_results,
      },
      questions: (questions || []).map((q) => ({
        id: q.id,
        question_type: q.question_type === 'open_response' ? 'open_response' : 'multiple_choice',
        question_text: q.question_text,
        options: q.options,
        correct_option: q.correct_option,
        answer_key: q.question_type === 'open_response' && typeof q.answer_key === 'string'
          ? q.answer_key
          : null,
        points: q.points,
        response_max_chars: q.response_max_chars,
        response_monospace: q.response_monospace === true,
        position: q.position,
      })),
      results: aggregated,
      students,
      responders,
      stats: {
        total_students: classroomStudentIds.length,
        responded: responders.length,
        open_questions_count: openQuestionIds.size,
        graded_open_responses: gradedOpenResponses,
        ungraded_open_responses: ungradedOpenResponses,
        returned_count: students.filter((student) => student.returned_at !== null).length,
      },
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Get test results error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

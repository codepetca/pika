import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { aggregateResults, canStudentViewResults } from '@/lib/quizzes'
import { assertStudentCanAccessTest } from '@/lib/server/tests'
import type { QuizQuestion, QuizResponse } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/student/tests/[id]/results - Get aggregated results (if allowed)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('student')
    const { id: testId } = await params

    const access = await assertStudentCanAccessTest(user.id, testId)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    const test = access.test
    const supabase = getServiceRoleClient()

    const { data: attempt, error: attemptError } = await supabase
      .from('test_attempts')
      .select('is_submitted')
      .eq('test_id', testId)
      .eq('student_id', user.id)
      .maybeSingle()

    if (attemptError && attemptError.code !== 'PGRST205') {
      console.error('Error checking test attempt submission:', attemptError)
      return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
    }

    const { data: studentResponses } = await supabase
      .from('test_responses')
      .select('id')
      .eq('test_id', testId)
      .eq('student_id', user.id)
      .limit(1)

    const hasResponded = Boolean(attempt?.is_submitted) || (studentResponses?.length || 0) > 0

    if (!canStudentViewResults(test, hasResponded)) {
      return NextResponse.json(
        { error: 'Results are not available for this test' },
        { status: 403 }
      )
    }

    const { data: questions, error: questionsError } = await supabase
      .from('test_questions')
      .select('id, question_type, question_text, options, correct_option, points, response_max_chars, position')
      .eq('test_id', testId)
      .order('position', { ascending: true })

    if (questionsError) {
      console.error('Error fetching test questions:', questionsError)
      return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
    }

    const hasOpenResponseQuestions = (questions || []).some(
      (question) => question.question_type === 'open_response'
    )
    if (hasOpenResponseQuestions && !test.grading_finalized_at) {
      return NextResponse.json(
        { error: 'Results are not available until grading is finalized' },
        { status: 403 }
      )
    }

    const { data: responses, error: responsesError } = await supabase
      .from('test_responses')
      .select('id, test_id, question_id, student_id, selected_option, response_text, score, feedback, graded_at, submitted_at')
      .eq('test_id', testId)

    if (responsesError) {
      console.error('Error fetching test responses:', responsesError)
      return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
    }

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

    const myResponses: Record<string, number> = {}
    const { data: myResponsesData, error: myResponsesError } = await supabase
      .from('test_responses')
      .select('id, question_id, selected_option, response_text, score, feedback, graded_at')
      .eq('test_id', testId)
      .eq('student_id', user.id)

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

    return NextResponse.json({
      quiz: {
        id: test.id,
        title: test.title,
        status: test.status,
        grading_finalized_at: test.grading_finalized_at,
      },
      results: aggregated,
      my_responses: myResponses,
      question_results: questionResults,
      summary: {
        earned_points: earnedPoints,
        possible_points: possiblePoints,
        percent,
      },
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Get student test results error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

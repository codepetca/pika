import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { aggregateResults, summarizeQuizFocusEvents } from '@/lib/quizzes'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
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

    const { data: responses, error: responsesError } = await supabase
      .from('test_responses')
      .select('id, test_id, question_id, student_id, selected_option, response_text, score, feedback, graded_at, graded_by, submitted_at')
      .eq('test_id', testId)

    if (responsesError) {
      console.error('Error fetching test responses:', responsesError)
      return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
    }

    const responderIds = [...new Set(responses?.map((r) => r.student_id) || [])]

    let responders: {
      student_id: string
      name: string | null
      email: string
      answers: Record<string, {
        response_id: string
        question_type: 'multiple_choice' | 'open_response'
        selected_option: number | null
        response_text: string | null
        score: number | null
        feedback: string | null
        graded_at: string | null
      }>
      focus_summary: QuizFocusSummary | null
    }[] = []

    if (responderIds.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('id, email')
        .in('id', responderIds)

      const { data: profiles } = await supabase
        .from('student_profiles')
        .select('user_id, first_name, last_name')
        .in('user_id', responderIds)

      const profileMap = new Map(
        profiles?.map((p) => [
          p.user_id,
          `${p.first_name} ${p.last_name}`.trim(),
        ]) || []
      )

      const questionById = new Map(
        (questions || []).map((question) => [question.id, question])
      )
      const studentAnswers: Record<string, Record<string, {
        response_id: string
        question_type: 'multiple_choice' | 'open_response'
        selected_option: number | null
        response_text: string | null
        score: number | null
        feedback: string | null
        graded_at: string | null
      }>> = {}
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
        }
      }

      const { data: focusEvents } = await supabase
        .from('test_focus_events')
        .select('student_id, event_type, occurred_at')
        .eq('test_id', testId)
        .in('student_id', responderIds)
        .order('occurred_at', { ascending: true })

      const grouped = new Map<string, Array<{ event_type: any; occurred_at: string }>>()
      for (const row of focusEvents || []) {
        const current = grouped.get(row.student_id) || []
        current.push({ event_type: row.event_type, occurred_at: row.occurred_at })
        grouped.set(row.student_id, current)
      }

      const focusSummaryByStudent = new Map<string, QuizFocusSummary>()
      for (const [studentId, events] of grouped) {
        focusSummaryByStudent.set(studentId, summarizeQuizFocusEvents(events))
      }

      responders = (users || []).map((u) => ({
        student_id: u.id,
        name: profileMap.get(u.id) || null,
        email: u.email,
        answers: studentAnswers[u.id] || {},
        focus_summary: focusSummaryByStudent.get(u.id) || null,
      }))

      responders.sort((a, b) => {
        const nameA = a.name || a.email
        const nameB = b.name || b.email
        return nameA.localeCompare(nameB)
      })
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

    const { count: totalStudents } = await supabase
      .from('classroom_enrollments')
      .select('*', { count: 'exact', head: true })
      .eq('classroom_id', test.classroom_id)

    return NextResponse.json({
      quiz: {
        id: test.id,
        title: test.title,
        assessment_type: 'test' as const,
        status: test.status,
        show_results: test.show_results,
        grading_finalized_at: test.grading_finalized_at,
        grading_finalized_by: test.grading_finalized_by,
      },
      questions: (questions || []).map((q) => ({
        id: q.id,
        question_type: q.question_type === 'open_response' ? 'open_response' : 'multiple_choice',
        question_text: q.question_text,
        options: q.options,
        correct_option: q.correct_option,
        points: q.points,
        response_max_chars: q.response_max_chars,
        position: q.position,
      })),
      results: aggregated,
      responders,
      stats: {
        total_students: totalStudents || 0,
        responded: responderIds.length,
        open_questions_count: openQuestionIds.size,
        graded_open_responses: gradedOpenResponses,
        ungraded_open_responses: ungradedOpenResponses,
        grading_finalized: !!test.grading_finalized_at,
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

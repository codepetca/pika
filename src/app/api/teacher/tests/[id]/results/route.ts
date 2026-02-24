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
      .select('*')
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
      answers: Record<string, number>
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

      const studentAnswers: Record<string, Record<string, number>> = {}
      for (const response of responses || []) {
        if (!studentAnswers[response.student_id]) studentAnswers[response.student_id] = {}
        studentAnswers[response.student_id][response.question_id] = response.selected_option
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

    const aggregated = aggregateResults(
      (questions || []) as QuizQuestion[],
      (responses || []) as QuizResponse[]
    )

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
      },
      questions: (questions || []).map((q) => ({
        id: q.id,
        question_text: q.question_text,
        options: q.options,
        position: q.position,
      })),
      results: aggregated,
      responders,
      stats: {
        total_students: totalStudents || 0,
        responded: responderIds.length,
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

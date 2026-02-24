import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { getStudentQuizStatus, summarizeQuizFocusEvents } from '@/lib/quizzes'
import { assertStudentCanAccessTest } from '@/lib/server/tests'
import { normalizeTestResponses } from '@/lib/test-attempts'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/student/tests/[id] - Get test with questions
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
      .select('responses, is_submitted')
      .eq('test_id', testId)
      .eq('student_id', user.id)
      .maybeSingle()

    if (attemptError && attemptError.code !== 'PGRST205') {
      console.error('Error fetching student test attempt:', attemptError)
      return NextResponse.json({ error: 'Failed to fetch test progress' }, { status: 500 })
    }

    const draftResponses = normalizeTestResponses(attempt?.responses)

    const { data: responses } = await supabase
      .from('test_responses')
      .select('id')
      .eq('test_id', testId)
      .eq('student_id', user.id)
      .limit(1)

    const hasSubmitted = Boolean(attempt?.is_submitted) || (responses?.length || 0) > 0

    if (test.status === 'draft') {
      return NextResponse.json({ error: 'Test not found' }, { status: 404 })
    }
    if (test.status === 'closed' && !hasSubmitted) {
      return NextResponse.json({ error: 'Test not found' }, { status: 404 })
    }

    const studentStatus = getStudentQuizStatus(test, hasSubmitted)

    const { data: questions, error: questionsError } = await supabase
      .from('test_questions')
      .select('*')
      .eq('test_id', testId)
      .order('position', { ascending: true })

    if (questionsError) {
      console.error('Error fetching test questions:', questionsError)
      return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
    }

    let studentResponses: Record<string, number> = draftResponses
    if (hasSubmitted) {
      const { data: allResponses } = await supabase
        .from('test_responses')
        .select('question_id, selected_option')
        .eq('test_id', testId)
        .eq('student_id', user.id)

      const submittedResponses = Object.fromEntries(
        (allResponses || []).map((response) => [response.question_id, response.selected_option])
      )
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
        position: test.position,
        created_at: test.created_at,
        updated_at: test.updated_at,
      },
      questions: questions || [],
      student_status: studentStatus,
      student_responses: studentResponses,
      focus_summary: summarizeQuizFocusEvents(focusEvents || []),
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Get student test error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

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

    const { data: studentResponses } = await supabase
      .from('test_responses')
      .select('id')
      .eq('test_id', testId)
      .eq('student_id', user.id)
      .limit(1)

    const hasResponded = (studentResponses?.length || 0) > 0

    if (!canStudentViewResults(test, hasResponded)) {
      return NextResponse.json(
        { error: 'Results are not available for this test' },
        { status: 403 }
      )
    }

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

    const aggregated = aggregateResults(
      (questions || []) as QuizQuestion[],
      (responses || []) as QuizResponse[]
    )

    const myResponses: Record<string, number> = {}
    const { data: myResponsesData } = await supabase
      .from('test_responses')
      .select('question_id, selected_option')
      .eq('test_id', testId)
      .eq('student_id', user.id)

    for (const response of myResponsesData || []) {
      myResponses[response.question_id] = response.selected_option
    }

    return NextResponse.json({
      quiz: {
        id: test.id,
        title: test.title,
        status: test.status,
      },
      results: aggregated,
      my_responses: myResponses,
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

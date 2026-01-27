import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { aggregateResults, canStudentViewResults } from '@/lib/quizzes'
import type { QuizQuestion, QuizResponse } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/student/quizzes/[id]/results - Get aggregated results (if allowed)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('student')
    const { id: quizId } = await params

    const supabase = getServiceRoleClient()

    // Fetch quiz
    const { data: quiz, error: quizError } = await supabase
      .from('quizzes')
      .select(`
        *,
        classrooms!inner (
          id,
          archived_at
        )
      `)
      .eq('id', quizId)
      .single()

    if (quizError || !quiz) {
      return NextResponse.json({ error: 'Quiz not found' }, { status: 404 })
    }

    // Verify student is enrolled
    const { data: enrollment, error: enrollError } = await supabase
      .from('classroom_enrollments')
      .select('id')
      .eq('classroom_id', quiz.classroom_id)
      .eq('student_id', user.id)
      .single()

    if (enrollError || !enrollment) {
      return NextResponse.json({ error: 'Not enrolled in this classroom' }, { status: 403 })
    }

    // Check if student has responded
    const { data: studentResponses } = await supabase
      .from('quiz_responses')
      .select('id')
      .eq('quiz_id', quizId)
      .eq('student_id', user.id)
      .limit(1)

    const hasResponded = (studentResponses?.length || 0) > 0

    // Check if student can view results
    if (!canStudentViewResults(quiz, hasResponded)) {
      return NextResponse.json(
        { error: 'Results are not available for this quiz' },
        { status: 403 }
      )
    }

    // Fetch questions
    const { data: questions, error: questionsError } = await supabase
      .from('quiz_questions')
      .select('*')
      .eq('quiz_id', quizId)
      .order('position', { ascending: true })

    if (questionsError) {
      console.error('Error fetching questions:', questionsError)
      return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
    }

    // Fetch all responses
    const { data: responses, error: responsesError } = await supabase
      .from('quiz_responses')
      .select('*')
      .eq('quiz_id', quizId)

    if (responsesError) {
      console.error('Error fetching responses:', responsesError)
      return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
    }

    // Aggregate results
    const aggregated = aggregateResults(
      (questions || []) as QuizQuestion[],
      (responses || []) as QuizResponse[]
    )

    // Get student's own responses
    const myResponses: Record<string, number> = {}
    const { data: myResponsesData } = await supabase
      .from('quiz_responses')
      .select('question_id, selected_option')
      .eq('quiz_id', quizId)
      .eq('student_id', user.id)

    for (const r of myResponsesData || []) {
      myResponses[r.question_id] = r.selected_option
    }

    return NextResponse.json({
      quiz: {
        id: quiz.id,
        title: quiz.title,
        status: quiz.status,
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
    console.error('Get student quiz results error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

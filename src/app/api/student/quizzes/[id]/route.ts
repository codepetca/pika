import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { getStudentQuizStatus } from '@/lib/quizzes'
import { assertStudentCanAccessQuiz } from '@/lib/server/quizzes'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/student/quizzes/[id] - Get quiz with questions
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('student')
    const { id: quizId } = await params

    const access = await assertStudentCanAccessQuiz(user.id, quizId)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    const quiz = access.quiz
    const supabase = getServiceRoleClient()

    const { data: responses } = await supabase
      .from('quiz_responses')
      .select('id')
      .eq('quiz_id', quizId)
      .eq('student_id', user.id)
      .limit(1)

    const hasResponded = (responses?.length || 0) > 0

    if (quiz.status === 'draft') {
      return NextResponse.json({ error: 'Quiz not found' }, { status: 404 })
    }
    if (quiz.status === 'closed' && !hasResponded) {
      return NextResponse.json({ error: 'Quiz not found' }, { status: 404 })
    }

    const studentStatus = getStudentQuizStatus(quiz, hasResponded)

    const { data: questions, error: questionsError } = await supabase
      .from('quiz_questions')
      .select('*')
      .eq('quiz_id', quizId)
      .order('position', { ascending: true })

    if (questionsError) {
      console.error('Error fetching questions:', questionsError)
      return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
    }

    let studentResponses: Record<string, number> = {}
    if (hasResponded) {
      const { data: allResponses } = await supabase
        .from('quiz_responses')
        .select('question_id, selected_option')
        .eq('quiz_id', quizId)
        .eq('student_id', user.id)

      studentResponses = Object.fromEntries(
        (allResponses || []).map((response) => [response.question_id, response.selected_option])
      )
    }

    return NextResponse.json({
      quiz: {
        id: quiz.id,
        classroom_id: quiz.classroom_id,
        title: quiz.title,
        assessment_type: 'quiz' as const,
        status: quiz.status,
        show_results: quiz.show_results,
        position: quiz.position,
        student_status: studentStatus,
        created_at: quiz.created_at,
        updated_at: quiz.updated_at,
      },
      questions: questions || [],
      student_status: studentStatus,
      student_responses: studentResponses,
      focus_summary: null,
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Get student quiz error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

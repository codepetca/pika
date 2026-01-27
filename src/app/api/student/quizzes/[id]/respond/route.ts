import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/student/quizzes/[id]/respond - Submit all responses
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('student')
    const { id: quizId } = await params
    const body = await request.json()
    const { responses } = body

    // responses should be: { [question_id]: selected_option_index }
    if (!responses || typeof responses !== 'object') {
      return NextResponse.json({ error: 'Responses are required' }, { status: 400 })
    }

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

    if (quiz.classrooms.archived_at) {
      return NextResponse.json({ error: 'Classroom is archived' }, { status: 403 })
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

    // Quiz must be active
    if (quiz.status !== 'active') {
      return NextResponse.json({ error: 'Quiz is not active' }, { status: 400 })
    }

    // Check if student has already responded
    const { data: existingResponses } = await supabase
      .from('quiz_responses')
      .select('id')
      .eq('quiz_id', quizId)
      .eq('student_id', user.id)
      .limit(1)

    if ((existingResponses?.length || 0) > 0) {
      return NextResponse.json({ error: 'You have already responded to this quiz' }, { status: 400 })
    }

    // Fetch all questions for this quiz
    const { data: questions, error: questionsError } = await supabase
      .from('quiz_questions')
      .select('id, options')
      .eq('quiz_id', quizId)

    if (questionsError || !questions) {
      console.error('Error fetching questions:', questionsError)
      return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
    }

    // Validate that all questions are answered
    const questionIds = questions.map((q) => q.id)
    const responseQuestionIds = Object.keys(responses)

    const missingQuestions = questionIds.filter((qid) => !responseQuestionIds.includes(qid))
    if (missingQuestions.length > 0) {
      return NextResponse.json({ error: 'All questions must be answered' }, { status: 400 })
    }

    // Validate that response values are valid option indices
    const questionsMap = new Map(questions.map((q) => [q.id, q.options]))
    for (const [questionId, selectedOption] of Object.entries(responses)) {
      const options = questionsMap.get(questionId)
      if (!options) {
        return NextResponse.json({ error: `Invalid question ID: ${questionId}` }, { status: 400 })
      }
      if (typeof selectedOption !== 'number' || selectedOption < 0 || selectedOption >= options.length) {
        return NextResponse.json(
          { error: `Invalid option for question ${questionId}` },
          { status: 400 }
        )
      }
    }

    // Insert all responses
    const responsesToInsert = Object.entries(responses).map(([questionId, selectedOption]) => ({
      quiz_id: quizId,
      question_id: questionId,
      student_id: user.id,
      selected_option: selectedOption as number,
    }))

    const { error: insertError } = await supabase
      .from('quiz_responses')
      .insert(responsesToInsert)

    if (insertError) {
      console.error('Error inserting responses:', insertError)
      return NextResponse.json({ error: 'Failed to submit responses' }, { status: 500 })
    }

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Submit quiz response error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

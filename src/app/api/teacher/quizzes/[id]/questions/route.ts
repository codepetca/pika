import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { validateQuizOptions } from '@/lib/quizzes'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/quizzes/[id]/questions - Add a question
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id: quizId } = await params
    const body = await request.json()
    const { question_text, options } = body

    if (!question_text || !question_text.trim()) {
      return NextResponse.json({ error: 'Question text is required' }, { status: 400 })
    }

    if (!options || !Array.isArray(options)) {
      return NextResponse.json({ error: 'Options must be an array' }, { status: 400 })
    }

    const validation = validateQuizOptions(options)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const supabase = getServiceRoleClient()

    // Fetch quiz and verify ownership
    const { data: quiz, error: quizError } = await supabase
      .from('quizzes')
      .select(`
        *,
        classrooms!inner (
          teacher_id,
          archived_at
        )
      `)
      .eq('id', quizId)
      .single()

    if (quizError || !quiz) {
      return NextResponse.json({ error: 'Quiz not found' }, { status: 404 })
    }

    if (quiz.classrooms.teacher_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    if (quiz.classrooms.archived_at) {
      return NextResponse.json({ error: 'Classroom is archived' }, { status: 403 })
    }

    // Cannot add questions to non-draft quizzes
    if (quiz.status !== 'draft') {
      return NextResponse.json(
        { error: 'Cannot add questions to a quiz that is not in draft status' },
        { status: 400 }
      )
    }

    // Get next position
    const { data: lastQuestion } = await supabase
      .from('quiz_questions')
      .select('position')
      .eq('quiz_id', quizId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()

    const nextPosition = typeof lastQuestion?.position === 'number' ? lastQuestion.position + 1 : 0

    const { data: question, error } = await supabase
      .from('quiz_questions')
      .insert({
        quiz_id: quizId,
        question_text: question_text.trim(),
        options,
        position: nextPosition,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating question:', error)
      return NextResponse.json({ error: 'Failed to create question' }, { status: 500 })
    }

    return NextResponse.json({ question }, { status: 201 })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Create question error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

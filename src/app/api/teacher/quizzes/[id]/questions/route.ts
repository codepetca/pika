import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { validateQuizOptions } from '@/lib/quizzes'
import { assertTeacherOwnsQuiz } from '@/lib/server/quizzes'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/quizzes/[id]/questions - Add a question
export const POST = withErrorHandler('CreateTeacherQuizQuestion', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: quizId } = await context.params
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

  const access = await assertTeacherOwnsQuiz(user.id, quizId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const supabase = getServiceRoleClient()

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
})

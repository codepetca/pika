import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { validateQuizOptions } from '@/lib/quizzes'
import { assertTeacherOwnsQuiz } from '@/lib/server/quizzes'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// PATCH /api/teacher/quizzes/[id]/questions/[qid] - Update a question
export const PATCH = withErrorHandler('UpdateTeacherQuizQuestion', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: quizId, qid: questionId } = await context.params
  const body = await request.json()
  const { question_text, options } = body

  const access = await assertTeacherOwnsQuiz(user.id, quizId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const supabase = getServiceRoleClient()

  // Verify question belongs to this quiz
  const { data: existingQuestion, error: qError } = await supabase
    .from('quiz_questions')
    .select('*')
    .eq('id', questionId)
    .eq('quiz_id', quizId)
    .single()

  if (qError || !existingQuestion) {
    return NextResponse.json({ error: 'Question not found' }, { status: 404 })
  }

  // Build update object
  const updates: Record<string, any> = {}
  if (question_text !== undefined) {
    if (!question_text.trim()) {
      return NextResponse.json({ error: 'Question text cannot be empty' }, { status: 400 })
    }
    updates.question_text = question_text.trim()
  }
  if (options !== undefined) {
    if (!Array.isArray(options)) {
      return NextResponse.json({ error: 'Options must be an array' }, { status: 400 })
    }
    const validation = validateQuizOptions(options)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }
    updates.options = options
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
  }

  const { data: question, error } = await supabase
    .from('quiz_questions')
    .update(updates)
    .eq('id', questionId)
    .select()
    .single()

  if (error) {
    console.error('Error updating question:', error)
    return NextResponse.json({ error: 'Failed to update question' }, { status: 500 })
  }

  return NextResponse.json({ question })
})

// DELETE /api/teacher/quizzes/[id]/questions/[qid] - Delete a question
export const DELETE = withErrorHandler('DeleteTeacherQuizQuestion', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: quizId, qid: questionId } = await context.params

  const access = await assertTeacherOwnsQuiz(user.id, quizId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const supabase = getServiceRoleClient()

  // Verify question belongs to this quiz
  const { data: existingQuestion, error: qError } = await supabase
    .from('quiz_questions')
    .select('id')
    .eq('id', questionId)
    .eq('quiz_id', quizId)
    .single()

  if (qError || !existingQuestion) {
    return NextResponse.json({ error: 'Question not found' }, { status: 404 })
  }

  const { error } = await supabase
    .from('quiz_questions')
    .delete()
    .eq('id', questionId)

  if (error) {
    console.error('Error deleting question:', error)
    return NextResponse.json({ error: 'Failed to delete question' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
})

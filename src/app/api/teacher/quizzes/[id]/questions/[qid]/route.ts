import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { validateQuizOptions } from '@/lib/quizzes'
import { assertTeacherOwnsQuiz } from '@/lib/server/quizzes'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// PATCH /api/teacher/quizzes/[id]/questions/[qid] - Update a question
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; qid: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id: quizId, qid: questionId } = await params
    const body = await request.json()
    const { question_text, options } = body

    const access = await assertTeacherOwnsQuiz(user.id, quizId, { checkArchived: true })
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    const quiz = access.quiz
    const supabase = getServiceRoleClient()

    // Cannot modify questions on non-draft quizzes
    if (quiz.status !== 'draft') {
      return NextResponse.json(
        { error: 'Cannot modify questions on a quiz that is not in draft status' },
        { status: 400 }
      )
    }

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
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Update question error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/teacher/quizzes/[id]/questions/[qid] - Delete a question
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; qid: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id: quizId, qid: questionId } = await params

    const access = await assertTeacherOwnsQuiz(user.id, quizId, { checkArchived: true })
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    const quiz = access.quiz
    const supabase = getServiceRoleClient()

    // Cannot delete questions from non-draft quizzes
    if (quiz.status !== 'draft') {
      return NextResponse.json(
        { error: 'Cannot delete questions from a quiz that is not in draft status' },
        { status: 400 }
      )
    }

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
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Delete question error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

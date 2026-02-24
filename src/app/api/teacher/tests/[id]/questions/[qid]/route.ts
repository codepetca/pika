import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { validateQuizOptions } from '@/lib/quizzes'
import { assertTeacherOwnsTest } from '@/lib/server/tests'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// PATCH /api/teacher/tests/[id]/questions/[qid] - Update a question
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; qid: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id: testId, qid: questionId } = await params
    const body = await request.json()
    const { question_text, options } = body

    const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    const test = access.test
    const supabase = getServiceRoleClient()

    if (test.status !== 'draft') {
      return NextResponse.json(
        { error: 'Cannot modify questions on a test that is not in draft status' },
        { status: 400 }
      )
    }

    const { data: existingQuestion, error: qError } = await supabase
      .from('test_questions')
      .select('*')
      .eq('id', questionId)
      .eq('test_id', testId)
      .single()

    if (qError || !existingQuestion) {
      return NextResponse.json({ error: 'Question not found' }, { status: 404 })
    }

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
      .from('test_questions')
      .update(updates)
      .eq('id', questionId)
      .select()
      .single()

    if (error) {
      console.error('Error updating test question:', error)
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
    console.error('Update test question error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/teacher/tests/[id]/questions/[qid] - Delete a question
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; qid: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id: testId, qid: questionId } = await params

    const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    const test = access.test
    const supabase = getServiceRoleClient()

    if (test.status !== 'draft') {
      return NextResponse.json(
        { error: 'Cannot delete questions from a test that is not in draft status' },
        { status: 400 }
      )
    }

    const { data: existingQuestion, error: qError } = await supabase
      .from('test_questions')
      .select('id')
      .eq('id', questionId)
      .eq('test_id', testId)
      .single()

    if (qError || !existingQuestion) {
      return NextResponse.json({ error: 'Question not found' }, { status: 404 })
    }

    const { error } = await supabase
      .from('test_questions')
      .delete()
      .eq('id', questionId)

    if (error) {
      console.error('Error deleting test question:', error)
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
    console.error('Delete test question error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

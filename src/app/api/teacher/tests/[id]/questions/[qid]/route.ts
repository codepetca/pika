import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { validateTestQuestionUpdate } from '@/lib/test-questions'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// PATCH /api/teacher/tests/[id]/questions/[qid] - Update a question
export const PATCH = withErrorHandler('UpdateTeacherTestQuestion', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: testId, qid: questionId } = await context.params
  const body = (await request.json()) as Record<string, unknown>

  const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const supabase = getServiceRoleClient()

  const { data: existingQuestion, error: qError } = await supabase
    .from('test_questions')
    .select('*')
    .eq('id', questionId)
    .eq('test_id', testId)
    .single()

  if (qError || !existingQuestion) {
    return NextResponse.json({ error: 'Question not found' }, { status: 404 })
  }

  const currentQuestion = {
    question_type: existingQuestion.question_type === 'open_response' ? 'open_response' as const : 'multiple_choice' as const,
    question_text: String(existingQuestion.question_text || ''),
    options: Array.isArray(existingQuestion.options) ? existingQuestion.options.map((option: unknown) => String(option)) : [],
    correct_option:
      typeof existingQuestion.correct_option === 'number' && Number.isInteger(existingQuestion.correct_option)
        ? existingQuestion.correct_option
        : null,
    answer_key:
      typeof existingQuestion.answer_key === 'string' && existingQuestion.answer_key.trim().length > 0
        ? existingQuestion.answer_key.trim()
        : null,
    sample_solution:
      typeof existingQuestion.sample_solution === 'string' && existingQuestion.sample_solution.trim().length > 0
        ? existingQuestion.sample_solution.trim()
        : null,
    points: Number(existingQuestion.points ?? 1),
    response_max_chars: Number(existingQuestion.response_max_chars ?? 5000),
    response_monospace: existingQuestion.response_monospace === true,
  }

  const validation = validateTestQuestionUpdate(body, currentQuestion, {
    allowEmptyQuestionText: access.test.status === 'draft',
  })
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  const nextQuestion = validation.value
  const updates: Record<string, any> = {}
  if (nextQuestion.question_text !== currentQuestion.question_text) updates.question_text = nextQuestion.question_text
  if (JSON.stringify(nextQuestion.options) !== JSON.stringify(currentQuestion.options)) updates.options = nextQuestion.options
  if (nextQuestion.correct_option !== currentQuestion.correct_option) updates.correct_option = nextQuestion.correct_option
  if (nextQuestion.answer_key !== currentQuestion.answer_key) updates.answer_key = nextQuestion.answer_key
  if (nextQuestion.sample_solution !== currentQuestion.sample_solution) {
    updates.sample_solution = nextQuestion.sample_solution
  }
  if (nextQuestion.points !== currentQuestion.points) updates.points = nextQuestion.points
  if (nextQuestion.response_max_chars !== currentQuestion.response_max_chars) {
    updates.response_max_chars = nextQuestion.response_max_chars
  }
  if (nextQuestion.response_monospace !== currentQuestion.response_monospace) {
    updates.response_monospace = nextQuestion.response_monospace
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
})

// DELETE /api/teacher/tests/[id]/questions/[qid] - Delete a question
export const DELETE = withErrorHandler('DeleteTeacherTestQuestion', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: testId, qid: questionId } = await context.params

  const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const supabase = getServiceRoleClient()

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
})

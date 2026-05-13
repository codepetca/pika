import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { normalizeSurveyQuestionInput } from '@/lib/surveys'
import { assertTeacherOwnsSurvey } from '@/lib/server/surveys'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const PATCH = withErrorHandler('PatchTeacherSurveyQuestion', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: surveyId, qid: questionId } = await context.params
  const body = await request.json()

  const access = await assertTeacherOwnsSurvey(user.id, surveyId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const supabase = getServiceRoleClient()
  const { data: existingQuestion, error: questionError } = await supabase
    .from('survey_questions')
    .select('*')
    .eq('id', questionId)
    .eq('survey_id', surveyId)
    .single()

  if (questionError || !existingQuestion) {
    return NextResponse.json({ error: 'Question not found' }, { status: 404 })
  }

  const normalized = normalizeSurveyQuestionInput({
    question_type: body.question_type ?? existingQuestion.question_type,
    question_text: body.question_text ?? existingQuestion.question_text,
    options: body.options ?? existingQuestion.options,
    response_max_chars: body.response_max_chars ?? existingQuestion.response_max_chars,
  })
  if (!normalized.valid) {
    return NextResponse.json({ error: normalized.error }, { status: 400 })
  }

  const { data: question, error } = await supabase
    .from('survey_questions')
    .update(normalized.question)
    .eq('id', questionId)
    .select()
    .single()

  if (error || !question) {
    console.error('Error updating survey question:', error)
    return NextResponse.json({ error: 'Failed to update question' }, { status: 500 })
  }

  return NextResponse.json({ question })
})

export const DELETE = withErrorHandler('DeleteTeacherSurveyQuestion', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id: surveyId, qid: questionId } = await context.params

  const access = await assertTeacherOwnsSurvey(user.id, surveyId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const supabase = getServiceRoleClient()
  const { data: existingQuestion, error: questionError } = await supabase
    .from('survey_questions')
    .select('id')
    .eq('id', questionId)
    .eq('survey_id', surveyId)
    .single()

  if (questionError || !existingQuestion) {
    return NextResponse.json({ error: 'Question not found' }, { status: 404 })
  }

  const { error } = await supabase
    .from('survey_questions')
    .delete()
    .eq('id', questionId)

  if (error) {
    console.error('Error deleting survey question:', error)
    return NextResponse.json({ error: 'Failed to delete question' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
})

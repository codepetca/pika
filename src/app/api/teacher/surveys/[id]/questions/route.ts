import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { normalizeSurveyQuestionInput } from '@/lib/surveys'
import { assertTeacherOwnsSurvey } from '@/lib/server/surveys'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherSurveyQuestion', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: surveyId } = await context.params
  const body = await request.json()

  const access = await assertTeacherOwnsSurvey(user.id, surveyId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const normalized = normalizeSurveyQuestionInput(body)
  if (!normalized.valid) {
    return NextResponse.json({ error: normalized.error }, { status: 400 })
  }

  const supabase = getServiceRoleClient()
  const { data: lastQuestion } = await supabase
    .from('survey_questions')
    .select('position')
    .eq('survey_id', surveyId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextPosition = typeof lastQuestion?.position === 'number' ? lastQuestion.position + 1 : 0

  const { data: question, error } = await supabase
    .from('survey_questions')
    .insert({
      survey_id: surveyId,
      ...normalized.question,
      position: nextPosition,
    })
    .select()
    .single()

  if (error || !question) {
    console.error('Error creating survey question:', error)
    return NextResponse.json({ error: 'Failed to create question' }, { status: 500 })
  }

  return NextResponse.json({ question }, { status: 201 })
})

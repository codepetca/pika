import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertStudentCanAccessSurvey } from '@/lib/server/surveys'
import {
  canStudentRespondToSurvey,
  isSurveyVisibleToStudents,
  validateSurveyResponses,
} from '@/lib/surveys'
import { getServiceRoleClient } from '@/lib/supabase'
import type { SurveyQuestion } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostStudentSurveyRespond', async (request, context) => {
  const user = await requireRole('student')
  const { id: surveyId } = await context.params
  const body = await request.json()
  const { responses } = body as { responses?: Record<string, unknown> }

  if (!responses || typeof responses !== 'object') {
    return NextResponse.json({ error: 'Responses are required' }, { status: 400 })
  }

  const access = await assertStudentCanAccessSurvey(user.id, surveyId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const survey = access.survey

  if (survey.status !== 'active' || !isSurveyVisibleToStudents(survey)) {
    return NextResponse.json({ error: 'Survey is not open' }, { status: 400 })
  }

  const supabase = getServiceRoleClient()
  const { data: existingResponses } = await supabase
    .from('survey_responses')
    .select('id')
    .eq('survey_id', surveyId)
    .eq('student_id', user.id)
    .limit(1)

  const hasResponded = (existingResponses?.length || 0) > 0
  if (!canStudentRespondToSurvey(survey, hasResponded)) {
    return NextResponse.json({ error: 'You have already responded to this survey' }, { status: 400 })
  }

  const { data: questions, error: questionsError } = await supabase
    .from('survey_questions')
    .select('*')
    .eq('survey_id', surveyId)
    .order('position', { ascending: true })

  if (questionsError || !questions) {
    console.error('Error fetching survey questions:', questionsError)
    return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
  }

  const validation = validateSurveyResponses(questions as SurveyQuestion[], responses)
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  const now = new Date().toISOString()
  const rows = Object.entries(validation.responses).map(([questionId, response]) => ({
    survey_id: surveyId,
    question_id: questionId,
    student_id: user.id,
    selected_option:
      response.question_type === 'multiple_choice' ? response.selected_option : null,
    response_text:
      response.question_type === 'multiple_choice' ? null : response.response_text,
    submitted_at: hasResponded ? undefined : now,
    updated_at: now,
  }))

  const query = survey.dynamic_responses
    ? supabase
        .from('survey_responses')
        .upsert(rows, { onConflict: 'question_id,student_id' })
    : supabase
        .from('survey_responses')
        .insert(rows)

  const { error } = await query

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'You have already responded to this survey' }, { status: 400 })
    }
    console.error('Error saving survey responses:', error)
    return NextResponse.json({ error: 'Failed to submit responses' }, { status: 500 })
  }

  return NextResponse.json({ success: true, updated: hasResponded }, { status: hasResponded ? 200 : 201 })
})

import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertStudentCanAccessSurvey } from '@/lib/server/surveys'
import { aggregateSurveyResults } from '@/lib/surveys'
import { getServiceRoleClient } from '@/lib/supabase'
import type { SurveyQuestion, SurveyResponse } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetStudentSurveyResults', async (_request, context) => {
  const user = await requireRole('student')
  const { id: surveyId } = await context.params

  const access = await assertStudentCanAccessSurvey(user.id, surveyId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const survey = access.survey

  if (!survey.show_results) {
    return NextResponse.json({ error: 'Results are not available' }, { status: 403 })
  }

  const supabase = getServiceRoleClient()
  const { data: ownResponses } = await supabase
    .from('survey_responses')
    .select('id')
    .eq('survey_id', surveyId)
    .eq('student_id', user.id)
    .limit(1)

  if ((ownResponses?.length || 0) === 0) {
    return NextResponse.json({ error: 'Submit a response to view results' }, { status: 403 })
  }

  const { data: questions, error: questionsError } = await supabase
    .from('survey_questions')
    .select('*')
    .eq('survey_id', surveyId)
    .order('position', { ascending: true })

  if (questionsError) {
    console.error('Error fetching survey questions:', questionsError)
    return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
  }

  const { data: responses, error: responsesError } = await supabase
    .from('survey_responses')
    .select('*')
    .eq('survey_id', surveyId)

  if (responsesError) {
    console.error('Error fetching survey responses:', responsesError)
    return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
  }

  const results = aggregateSurveyResults(
    (questions || []) as SurveyQuestion[],
    (responses || []) as SurveyResponse[]
  ).map((result) => ({
    ...result,
    responses: result.responses.map((response) => ({
      response_id: response.response_id,
      student_id: response.student_id,
      response_text: response.response_text,
      submitted_at: response.submitted_at,
      updated_at: response.updated_at,
    })),
  }))

  return NextResponse.json({
    survey: {
      id: survey.id,
      title: survey.title,
      status: survey.status,
      show_results: survey.show_results,
      dynamic_responses: survey.dynamic_responses,
    },
    results,
  })
})

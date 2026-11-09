import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertStudentCanAccessSurvey } from '@/lib/server/surveys'
import { isSurveyVisibleToStudents } from '@/lib/surveys'
import { surveyResponseSchema } from '@/lib/validations/surveys'
import { getServiceRoleClient } from '@/lib/supabase'
import type { SurveyQuestion } from '@/types'
import { authorizeSharedSurveyActor, createContextualSurveyRetryBudget, readContextualSurveyDetail, respondToContextualSurvey } from '@/lib/server/contextual-surveys'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostStudentSurveyRespond', async (request, context) => {
  const shared = await authorizeSharedSurveyActor()
  if (shared.mode === 'shared') {
    const { id: surveyId } = await context.params
    const retryBudget = createContextualSurveyRetryBudget()
    const detail = await readContextualSurveyDetail({ actorId: shared.user.id, surveyId, permission: 'member', retryBudget })
    const { responses } = surveyResponseSchema.parse(await request.json())
    const result = await respondToContextualSurvey({ actorId: shared.user.id, surveyId, retryBudget,
      detail: { survey: detail.survey, questions: detail.questions as SurveyQuestion[] }, responses })
    return NextResponse.json(result, { status: result.updated ? 200 : 201 })
  }
  const user = await requireRole('student')
  const { id: surveyId } = await context.params
  const access = await assertStudentCanAccessSurvey(user.id, surveyId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const { responses } = surveyResponseSchema.parse(await request.json())
  const survey = access.survey

  if (survey.status !== 'active' || !isSurveyVisibleToStudents(survey)) {
    return NextResponse.json({ error: 'Survey is not open' }, { status: 400 })
  }

  const supabase = getServiceRoleClient()
  const { data: questions, error: questionsError } = await supabase
    .from('survey_questions')
    .select('*')
    .eq('survey_id', surveyId)
    .order('position', { ascending: true })
    .order('id', { ascending: true })

  if (questionsError || !questions) {
    console.error('Error fetching survey questions:', questionsError)
    return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
  }

  const result = await respondToContextualSurvey({
    actorId: user.id,
    surveyId,
    detail: { survey, questions: questions as SurveyQuestion[] },
    responses,
  })
  return NextResponse.json(result, { status: result.updated ? 200 : 201 })
})

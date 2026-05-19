import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertStudentCanAccessSurvey } from '@/lib/server/surveys'
import {
  canStudentViewSurveyResults,
  getStudentSurveyStatus,
  isSurveyVisibleToStudents,
} from '@/lib/surveys'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetStudentSurvey', async (_request, context) => {
  const user = await requireRole('student')
  const { id: surveyId } = await context.params

  const access = await assertStudentCanAccessSurvey(user.id, surveyId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const survey = access.survey
  const supabase = getServiceRoleClient()

  const { data: responseRows } = await supabase
    .from('survey_responses')
    .select('question_id, selected_option, response_text')
    .eq('survey_id', surveyId)
    .eq('student_id', user.id)

  const hasResponded = (responseRows?.length || 0) > 0
  const canViewResults = canStudentViewSurveyResults(survey)

  if (survey.status === 'draft') {
    return NextResponse.json({ error: 'Survey not found' }, { status: 404 })
  }
  if (survey.status === 'active' && !isSurveyVisibleToStudents(survey) && !canViewResults && !hasResponded) {
    return NextResponse.json({ error: 'Survey not found' }, { status: 404 })
  }
  if (survey.status === 'closed' && !hasResponded && !canViewResults) {
    return NextResponse.json({ error: 'Survey not found' }, { status: 404 })
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

  const questionTypeById = new Map(
    (questions || []).map((question) => [question.id, question.question_type])
  )
  const studentResponses = Object.fromEntries(
    (responseRows || []).map((response) => {
      const questionType = questionTypeById.get(response.question_id)
      return [
        response.question_id,
        response.selected_option !== null
          ? {
              question_type: 'multiple_choice' as const,
              selected_option: response.selected_option,
            }
          : {
              question_type: questionType === 'link' ? 'link' as const : 'short_text' as const,
              response_text: response.response_text || '',
            },
      ]
    })
  )

  const studentStatus = getStudentSurveyStatus(survey, hasResponded)

  return NextResponse.json({
    survey: {
      id: survey.id,
      classroom_id: survey.classroom_id,
      title: survey.title,
      status: survey.status,
      opens_at: survey.opens_at,
      show_results: survey.show_results,
      dynamic_responses: survey.dynamic_responses,
      position: survey.position,
      student_status: studentStatus,
      created_at: survey.created_at,
      updated_at: survey.updated_at,
    },
    questions: questions || [],
    student_status: studentStatus,
    has_submitted: hasResponded,
    student_responses: studentResponses,
  })
})

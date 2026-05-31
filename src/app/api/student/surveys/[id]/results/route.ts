import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertStudentCanAccessSurvey } from '@/lib/server/surveys'
import { aggregateSurveyResults, canStudentViewSurveyResults } from '@/lib/surveys'
import { getServiceRoleClient } from '@/lib/supabase'
import { getClassroomStudentIds } from '@/lib/server/classrooms'
import { chunkValues, loadPagedRows } from '@/lib/server/query-chunks'
import type { SurveyQuestion, SurveyResponse } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const STUDENT_SURVEY_RESULTS_PAGE_SIZE = 1000

async function loadSurveyQuestions(
  supabase: any,
  surveyId: string
): Promise<{ rows: SurveyQuestion[]; error: any }> {
  return loadPagedRows<SurveyQuestion>(() =>
    supabase
      .from('survey_questions')
      .select('*')
      .eq('survey_id', surveyId),
    STUDENT_SURVEY_RESULTS_PAGE_SIZE,
    'position'
  )
}

async function loadSurveyResponsesForStudents(
  supabase: any,
  surveyId: string,
  studentIds: string[]
): Promise<{ rows: SurveyResponse[]; error: any }> {
  if (studentIds.length === 0) return { rows: [], error: null }

  const rows: SurveyResponse[] = []
  for (const studentIdChunk of chunkValues(studentIds)) {
    const result = await loadPagedRows<SurveyResponse>(() =>
      supabase
        .from('survey_responses')
        .select('*')
        .eq('survey_id', surveyId)
        .in('student_id', studentIdChunk),
      STUDENT_SURVEY_RESULTS_PAGE_SIZE
    )

    if (result.error) return result
    rows.push(...result.rows)
  }

  return { rows, error: null }
}

export const GET = withErrorHandler('GetStudentSurveyResults', async (_request, context) => {
  const user = await requireRole('student')
  const { id: surveyId } = await context.params

  const access = await assertStudentCanAccessSurvey(user.id, surveyId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const survey = access.survey

  if (!canStudentViewSurveyResults(survey)) {
    return NextResponse.json({ error: 'Results are not available' }, { status: 403 })
  }

  const supabase = getServiceRoleClient()
  const { rows: questions, error: questionsError } = await loadSurveyQuestions(supabase, surveyId)

  if (questionsError) {
    console.error('Error fetching survey questions:', questionsError)
    return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
  }

  const classroomStudentsResult = await getClassroomStudentIds(supabase, survey.classroom_id)
  if (classroomStudentsResult.error) {
    console.error('Error fetching classroom enrollments for survey results:', classroomStudentsResult.error)
    return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
  }

  const { rows: responses, error: responsesError } = await loadSurveyResponsesForStudents(
    supabase,
    surveyId,
    classroomStudentsResult.studentIds
  )

  if (responsesError) {
    console.error('Error fetching survey responses:', responsesError)
    return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
  }

  const scopedResponses = (responses || []).filter((response) =>
    classroomStudentsResult.studentIdSet.has(response.student_id)
  )

  const results = aggregateSurveyResults(
    (questions || []) as SurveyQuestion[],
    scopedResponses as SurveyResponse[]
  ).map((result) => ({
    ...result,
    responses: result.responses.map((response) => ({
      response_id: response.response_id,
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

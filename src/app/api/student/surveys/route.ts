import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { isMissingSurveysTableError } from '@/lib/server/surveys'
import { canStudentViewSurveyResults, getStudentSurveyStatus, isSurveyVisibleToStudents } from '@/lib/surveys'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetStudentSurveys', async (request) => {
  const user = await requireRole('student')
  const { searchParams } = new URL(request.url)
  const classroomId = searchParams.get('classroom_id')

  if (!classroomId) {
    return NextResponse.json({ error: 'classroom_id is required' }, { status: 400 })
  }

  const access = await assertStudentCanAccessClassroom(user.id, classroomId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const supabase = getServiceRoleClient()
  const { data: surveys, error: surveysError } = await supabase
    .from('surveys')
    .select('*')
    .eq('classroom_id', classroomId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (surveysError) {
    if (isMissingSurveysTableError(surveysError)) {
      return NextResponse.json({ surveys: [] })
    }
    console.error('Error fetching student surveys:', surveysError)
    return NextResponse.json({ error: 'Failed to fetch surveys' }, { status: 500 })
  }

  const surveyIds = (surveys || []).map((survey) => survey.id)
  const responseMap = new Map<string, boolean>()

  if (surveyIds.length > 0) {
    const { data: responseRows } = await supabase
      .from('survey_responses')
      .select('survey_id')
      .eq('student_id', user.id)
      .in('survey_id', surveyIds)

    for (const row of responseRows || []) {
      responseMap.set(row.survey_id, true)
    }
  }

  const visibleSurveys = (surveys || [])
    .filter((survey) =>
      isSurveyVisibleToStudents(survey) ||
      canStudentViewSurveyResults(survey) ||
      responseMap.has(survey.id)
    )
    .map((survey) => {
      const hasResponded = responseMap.has(survey.id)
      return {
        ...survey,
        student_status: getStudentSurveyStatus(survey, hasResponded),
      }
    })

  return NextResponse.json({ surveys: visibleSurveys })
})

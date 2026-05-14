import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertTeacherCanMutateClassroom, assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { isMissingSurveysTableError } from '@/lib/server/surveys'
import { getServiceRoleClient } from '@/lib/supabase'
import { getFallbackAssessmentTitle } from '@/lib/assessment-titles'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function getNextClassworkPosition(classroomId: string) {
  const supabase = getServiceRoleClient()
  const [lastAssignmentResult, lastMaterialResult, lastSurveyResult] = await Promise.all([
    supabase
      .from('assignments')
      .select('position')
      .eq('classroom_id', classroomId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('classwork_materials')
      .select('position')
      .eq('classroom_id', classroomId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('surveys')
      .select('position')
      .eq('classroom_id', classroomId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (lastAssignmentResult.error) throw lastAssignmentResult.error
  if (lastMaterialResult.error && !String(lastMaterialResult.error.message || '').includes('classwork_materials')) {
    throw lastMaterialResult.error
  }
  if (lastSurveyResult.error && !isMissingSurveysTableError(lastSurveyResult.error)) {
    throw lastSurveyResult.error
  }

  const positions = [
    lastAssignmentResult.data?.position,
    lastMaterialResult.data?.position,
    lastSurveyResult.data?.position,
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

  return (positions.length > 0 ? Math.max(...positions) : -1) + 1
}

export const GET = withErrorHandler('GetTeacherSurveys', async (request) => {
  const user = await requireRole('teacher')
  const { searchParams } = new URL(request.url)
  const classroomId = searchParams.get('classroom_id')

  if (!classroomId) {
    return NextResponse.json({ error: 'classroom_id is required' }, { status: 400 })
  }

  const ownership = await assertTeacherOwnsClassroom(user.id, classroomId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
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
      return NextResponse.json({ surveys: [], migration_required: true })
    }
    console.error('Error fetching surveys:', surveysError)
    return NextResponse.json({ error: 'Failed to fetch surveys' }, { status: 500 })
  }

  const { count: totalStudents } = await supabase
    .from('classroom_enrollments')
    .select('*', { count: 'exact', head: true })
    .eq('classroom_id', classroomId)

  const surveyIds = (surveys || []).map((survey) => survey.id)

  const questionCountMap: Record<string, number> = {}
  if (surveyIds.length > 0) {
    const { data: questionRows } = await supabase
      .from('survey_questions')
      .select('survey_id')
      .in('survey_id', surveyIds)

    for (const row of questionRows || []) {
      questionCountMap[row.survey_id] = (questionCountMap[row.survey_id] || 0) + 1
    }
  }

  const respondentCountMap: Record<string, number> = {}
  if (surveyIds.length > 0) {
    const { data: responseRows } = await supabase
      .from('survey_responses')
      .select('survey_id, student_id')
      .in('survey_id', surveyIds)

    const seen: Record<string, Set<string>> = {}
    for (const row of responseRows || []) {
      if (!seen[row.survey_id]) seen[row.survey_id] = new Set()
      seen[row.survey_id].add(row.student_id)
    }
    for (const [surveyId, students] of Object.entries(seen)) {
      respondentCountMap[surveyId] = students.size
    }
  }

  return NextResponse.json({
    surveys: (surveys || []).map((survey) => ({
      ...survey,
      stats: {
        total_students: totalStudents || 0,
        responded: respondentCountMap[survey.id] || 0,
        questions_count: questionCountMap[survey.id] || 0,
      },
    })),
  })
})

export const POST = withErrorHandler('PostTeacherSurvey', async (request) => {
  const user = await requireRole('teacher')
  const body = await request.json()
  const { classroom_id, title, show_results = true, dynamic_responses = false } = body as {
    classroom_id?: string
    title?: string
    show_results?: boolean
    dynamic_responses?: boolean
  }

  if (!classroom_id) {
    return NextResponse.json({ error: 'classroom_id is required' }, { status: 400 })
  }

  const cleanTitle = title?.trim() || getFallbackAssessmentTitle()

  const ownership = await assertTeacherCanMutateClassroom(user.id, classroom_id)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }

  const supabase = getServiceRoleClient()
  let position = 0
  try {
    position = await getNextClassworkPosition(classroom_id)
  } catch (error) {
    console.error('Error fetching classwork position for survey:', error)
    return NextResponse.json({ error: 'Failed to create survey' }, { status: 500 })
  }

  const { data: survey, error } = await supabase
    .from('surveys')
    .insert({
      classroom_id,
      title: cleanTitle,
      show_results: show_results === true,
      dynamic_responses: dynamic_responses === true,
      created_by: user.id,
      position,
    })
    .select()
    .single()

  if (error || !survey) {
    console.error('Error creating survey:', error)
    return NextResponse.json({ error: 'Failed to create survey' }, { status: 500 })
  }

  return NextResponse.json({ survey }, { status: 201 })
})

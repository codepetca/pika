import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertTeacherCanMutateClassroom, assertTeacherOwnsClassroom, getClassroomStudentIds } from '@/lib/server/classrooms'
import { isMissingSurveysTableError } from '@/lib/server/surveys'
import { getServiceRoleClient } from '@/lib/supabase'
import { getFallbackAssessmentTitle } from '@/lib/assessment-titles'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type SurveyQuestionStatsRow = {
  survey_id: string
}

type SurveyResponseStatsRow = {
  survey_id: string
  student_id: string
}

const SURVEY_LIST_STATS_FILTER_CHUNK_SIZE = 50
const SURVEY_LIST_STATS_PAGE_SIZE = 1000

function chunkIds(ids: string[], chunkSize: number): string[][] {
  const chunks: string[][] = []
  for (let index = 0; index < ids.length; index += chunkSize) {
    chunks.push(ids.slice(index, index + chunkSize))
  }
  return chunks
}

async function loadPagedRows<T>(buildQuery: () => any): Promise<{ rows: T[]; error: any }> {
  const rows: T[] = []
  let offset = 0

  while (true) {
    let query = buildQuery()
    const supportsRange = typeof query.range === 'function'
    if (supportsRange && typeof query.order === 'function') {
      query = query.order('id', { ascending: true })
    }
    if (supportsRange) {
      query = query.range(offset, offset + SURVEY_LIST_STATS_PAGE_SIZE - 1)
    }

    const { data, error } = await query
    if (error) {
      return { rows: [], error }
    }

    const pageRows = (data || []) as T[]
    rows.push(...pageRows)

    if (!supportsRange || pageRows.length < SURVEY_LIST_STATS_PAGE_SIZE) break
    offset += SURVEY_LIST_STATS_PAGE_SIZE
  }

  return { rows, error: null }
}

async function loadSurveyQuestionRows(
  supabase: any,
  surveyIds: string[]
): Promise<{ rows: SurveyQuestionStatsRow[]; error: any }> {
  if (surveyIds.length === 0) {
    return { rows: [], error: null }
  }

  const rows: SurveyQuestionStatsRow[] = []
  for (const surveyIdChunk of chunkIds(surveyIds, SURVEY_LIST_STATS_FILTER_CHUNK_SIZE)) {
    const result = await loadPagedRows<SurveyQuestionStatsRow>(() =>
      supabase
        .from('survey_questions')
        .select('survey_id')
        .in('survey_id', surveyIdChunk)
    )

    if (result.error) {
      return { rows: [], error: result.error }
    }

    rows.push(...result.rows)
  }

  return { rows, error: null }
}

async function loadSurveyResponseRows(
  supabase: any,
  surveyIds: string[],
  studentIds: string[]
): Promise<{ rows: SurveyResponseStatsRow[]; error: any }> {
  if (surveyIds.length === 0 || studentIds.length === 0) {
    return { rows: [], error: null }
  }

  const rows: SurveyResponseStatsRow[] = []
  for (const surveyIdChunk of chunkIds(surveyIds, SURVEY_LIST_STATS_FILTER_CHUNK_SIZE)) {
    for (const studentIdChunk of chunkIds(studentIds, SURVEY_LIST_STATS_FILTER_CHUNK_SIZE)) {
      const result = await loadPagedRows<SurveyResponseStatsRow>(() =>
        supabase
          .from('survey_responses')
          .select('survey_id, student_id')
          .in('survey_id', surveyIdChunk)
          .in('student_id', studentIdChunk)
      )

      if (result.error) {
        return { rows: [], error: result.error }
      }

      rows.push(...result.rows)
    }
  }

  return { rows, error: null }
}

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

  const classroomStudentsResult = await getClassroomStudentIds(supabase, classroomId)
  if (classroomStudentsResult.error) {
    console.error('Error fetching classroom enrollments:', classroomStudentsResult.error)
    return NextResponse.json({ error: 'Failed to fetch classroom enrollments' }, { status: 500 })
  }

  const surveyIds = (surveys || []).map((survey) => survey.id)

  const questionCountMap: Record<string, number> = {}
  if (surveyIds.length > 0) {
    const { rows: questionRows, error: questionRowsError } = await loadSurveyQuestionRows(supabase, surveyIds)

    if (questionRowsError) {
      console.error('Error fetching survey question stats:', questionRowsError)
      return NextResponse.json({ error: 'Failed to fetch survey question stats' }, { status: 500 })
    }

    for (const row of questionRows || []) {
      questionCountMap[row.survey_id] = (questionCountMap[row.survey_id] || 0) + 1
    }
  }

  const respondentCountMap: Record<string, number> = {}
  if (surveyIds.length > 0 && classroomStudentsResult.studentIds.length > 0) {
    const {
      rows: responseRows,
      error: responseRowsError,
    } = await loadSurveyResponseRows(supabase, surveyIds, classroomStudentsResult.studentIds)

    if (responseRowsError) {
      console.error('Error fetching survey response stats:', responseRowsError)
      return NextResponse.json({ error: 'Failed to fetch survey response stats' }, { status: 500 })
    }

    const seen: Record<string, Set<string>> = {}
    for (const row of responseRows || []) {
      if (!classroomStudentsResult.studentIdSet.has(row.student_id)) continue
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
        total_students: classroomStudentsResult.totalStudents,
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

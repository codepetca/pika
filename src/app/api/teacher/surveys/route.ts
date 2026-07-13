import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertTeacherCanMutateClassroom, assertTeacherOwnsClassroom, getClassroomStudentIds } from '@/lib/server/classrooms'
import {
  isMissingSurveyDueColumnsError,
  isMissingSurveysTableError,
  SURVEY_DUE_MIGRATION_REQUIRED,
} from '@/lib/server/surveys'
import { getServiceRoleClient } from '@/lib/supabase'
import { getFallbackAssessmentTitle } from '@/lib/assessment-titles'
import { loadChunkedRows } from '@/lib/server/query-chunks'
import type { SurveyDuePolicy } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type SurveyQuestionStatsRow = {
  survey_id: string
}

type SurveyResponseStatsRow = {
  survey_id: string
  student_id: string
}

type SurveyInsertPayload = {
  classroom_id: string
  title: string
  show_results: boolean
  dynamic_responses: boolean
  due_at?: string | null
  due_policy?: SurveyDuePolicy
  created_by: string
  position: number
}

const SURVEY_LIST_STATS_PAGE_SIZE = 1000

async function loadSurveyQuestionRows(
  supabase: any,
  surveyIds: string[]
): Promise<{ rows: SurveyQuestionStatsRow[]; error: any }> {
  return loadChunkedRows<SurveyQuestionStatsRow>({
    supabase,
    table: 'survey_questions',
    select: 'survey_id',
    filters: [{ column: 'survey_id', values: surveyIds }],
    pageSize: SURVEY_LIST_STATS_PAGE_SIZE,
  })
}

async function loadSurveyResponseRows(
  supabase: any,
  surveyIds: string[],
  studentIds: string[]
): Promise<{ rows: SurveyResponseStatsRow[]; error: any }> {
  return loadChunkedRows<SurveyResponseStatsRow>({
    supabase,
    table: 'survey_responses',
    select: 'survey_id, student_id',
    filters: [
      { column: 'survey_id', values: surveyIds },
      { column: 'student_id', values: studentIds },
    ],
    pageSize: SURVEY_LIST_STATS_PAGE_SIZE,
  })
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
  const { classroom_id, title, show_results = true, dynamic_responses = false, due_at, due_policy = 'soft' } = body as {
    classroom_id?: string
    title?: string
    show_results?: boolean
    dynamic_responses?: boolean
    due_at?: string | null
    due_policy?: SurveyDuePolicy
  }

  if (!classroom_id) {
    return NextResponse.json({ error: 'classroom_id is required' }, { status: 400 })
  }

  const cleanTitle = title?.trim() || getFallbackAssessmentTitle()
  const validDuePolicies: SurveyDuePolicy[] = ['soft', 'hard']
  if (!validDuePolicies.includes(due_policy)) {
    return NextResponse.json({ error: 'Invalid due policy' }, { status: 400 })
  }

  let parsedDueAt: string | null = null
  if (due_at) {
    const parsed = new Date(due_at)
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: 'Invalid due date' }, { status: 400 })
    }
    parsedDueAt = parsed.toISOString()
  }

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

  const buildInsertPayload = (): SurveyInsertPayload => {
    const payload: SurveyInsertPayload = {
      classroom_id,
      title: cleanTitle,
      show_results: show_results === true,
      dynamic_responses: dynamic_responses === true,
      created_by: user.id,
      position,
      due_at: parsedDueAt,
      due_policy,
    }
    return payload
  }

  const { data: survey, error } = await supabase
    .from('surveys')
    .insert(buildInsertPayload())
    .select()
    .single()

  if (error && isMissingSurveyDueColumnsError(error)) {
    return NextResponse.json(SURVEY_DUE_MIGRATION_REQUIRED, { status: 503 })
  }

  if (error || !survey) {
    console.error('Error creating survey:', error)
    return NextResponse.json({ error: 'Failed to create survey' }, { status: 500 })
  }

  return NextResponse.json({ survey }, { status: 201 })
})

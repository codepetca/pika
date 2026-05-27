import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { aggregateSurveyResults } from '@/lib/surveys'
import { getClassroomStudentIds } from '@/lib/server/classrooms'
import { assertTeacherOwnsSurvey } from '@/lib/server/surveys'
import { getServiceRoleClient } from '@/lib/supabase'
import type { SurveyQuestion, SurveyResponse } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetTeacherSurveyResults', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id: surveyId } = await context.params

  const access = await assertTeacherOwnsSurvey(user.id, surveyId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const survey = access.survey

  const supabase = getServiceRoleClient()
  const { data: questions, error: questionsError } = await supabase
    .from('survey_questions')
    .select('*')
    .eq('survey_id', surveyId)
    .order('position', { ascending: true })

  if (questionsError) {
    console.error('Error fetching survey questions:', questionsError)
    return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
  }

  const classroomStudentsResult = await getClassroomStudentIds(supabase, survey.classroom_id)
  if (classroomStudentsResult.error) {
    console.error('Error fetching classroom enrollments:', classroomStudentsResult.error)
    return NextResponse.json({ error: 'Failed to fetch classroom enrollments' }, { status: 500 })
  }

  const responseResult = classroomStudentsResult.studentIds.length > 0
    ? await supabase
      .from('survey_responses')
      .select('*')
      .eq('survey_id', surveyId)
      .in('student_id', classroomStudentsResult.studentIds)
    : { data: [], error: null }
  const { data: responseRows, error: responsesError } = responseResult
  const responses = (responseRows || []).filter((response) =>
    classroomStudentsResult.studentIdSet.has(response.student_id)
  )

  if (responsesError) {
    console.error('Error fetching survey responses:', responsesError)
    return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
  }

  const responderIds = [...new Set((responses || []).map((response) => response.student_id))]
  const usersById = new Map<string, { email: string; name: string | null }>()

  if (responderIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, email')
      .in('id', responderIds)

    const { data: profiles } = await supabase
      .from('student_profiles')
      .select('user_id, first_name, last_name')
      .in('user_id', responderIds)

    const profileMap = new Map(
      (profiles || []).map((profile) => [
        profile.user_id,
        `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
      ])
    )

    for (const userRecord of users || []) {
      usersById.set(userRecord.id, {
        email: userRecord.email,
        name: profileMap.get(userRecord.id) || null,
      })
    }
  }

  const results = aggregateSurveyResults(
    (questions || []) as SurveyQuestion[],
    responses as SurveyResponse[]
  ).map((result) => ({
    ...result,
    responses: result.responses.map((response) => {
      const userRecord = usersById.get(response.student_id)
      return {
        ...response,
        name: userRecord?.name ?? null,
        email: userRecord?.email ?? null,
      }
    }),
  }))

  const responders = responderIds
    .map((studentId) => {
      const userRecord = usersById.get(studentId)
      return {
        student_id: studentId,
        name: userRecord?.name ?? null,
        email: userRecord?.email ?? '',
      }
    })
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email))

  return NextResponse.json({
    survey: {
      id: survey.id,
      title: survey.title,
      status: survey.status,
      show_results: survey.show_results,
      dynamic_responses: survey.dynamic_responses,
    },
    questions: (questions || []).map((question) => ({
      id: question.id,
      question_type: question.question_type,
      question_text: question.question_text,
      options: question.options,
      response_max_chars: question.response_max_chars,
      position: question.position,
    })),
    results,
    responders,
    stats: {
      total_students: classroomStudentsResult.totalStudents,
      responded: responderIds.length,
    },
  })
})

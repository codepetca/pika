import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { aggregateSurveyResults } from '@/lib/surveys'
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

  const { data: responses, error: responsesError } = await supabase
    .from('survey_responses')
    .select('*')
    .eq('survey_id', surveyId)

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
    (responses || []) as SurveyResponse[]
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

  const { count: totalStudents } = await supabase
    .from('classroom_enrollments')
    .select('*', { count: 'exact', head: true })
    .eq('classroom_id', survey.classroom_id)

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
      total_students: totalStudents || 0,
      responded: responderIds.length,
    },
  })
})

import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { aggregateResults } from '@/lib/quizzes'
import { assertTeacherOwnsQuiz } from '@/lib/server/quizzes'
import { getClassroomStudentIds } from '@/lib/server/classrooms'
import { loadChunkedRows } from '@/lib/server/query-chunks'
import type { QuizFocusSummary, QuizQuestion, QuizResponse } from '@/types'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const QUIZ_RESULTS_PAGE_SIZE = 1000

type ResponderUserRow = {
  id: string
  email: string
}

type ResponderProfileRow = {
  user_id: string
  first_name: string | null
  last_name: string | null
}

async function loadQuizResponses(
  supabase: any,
  quizId: string,
  studentIds: string[]
): Promise<{ rows: QuizResponse[]; error: any }> {
  return loadChunkedRows<QuizResponse>({
    supabase,
    table: 'quiz_responses',
    select: '*',
    filters: [
      { column: 'quiz_id', values: [quizId] },
      { column: 'student_id', values: studentIds },
    ],
    pageSize: QUIZ_RESULTS_PAGE_SIZE,
  })
}

async function loadResponderUsers(
  supabase: any,
  responderIds: string[]
): Promise<{ rows: ResponderUserRow[]; error: any }> {
  return loadChunkedRows<ResponderUserRow>({
    supabase,
    table: 'users',
    select: 'id, email',
    filters: [{ column: 'id', values: responderIds }],
    pageSize: QUIZ_RESULTS_PAGE_SIZE,
  })
}

async function loadResponderProfiles(
  supabase: any,
  responderIds: string[]
): Promise<{ rows: ResponderProfileRow[]; error: any }> {
  return loadChunkedRows<ResponderProfileRow>({
    supabase,
    table: 'student_profiles',
    select: 'user_id, first_name, last_name',
    filters: [{ column: 'user_id', values: responderIds }],
    pageSize: QUIZ_RESULTS_PAGE_SIZE,
  })
}

// GET /api/teacher/quizzes/[id]/results - Get aggregated results
export const GET = withErrorHandler('GetTeacherQuizResults', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: quizId } = await context.params

  const access = await assertTeacherOwnsQuiz(user.id, quizId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const quiz = access.quiz
  const supabase = getServiceRoleClient()

  const { data: questions, error: questionsError } = await supabase
    .from('quiz_questions')
    .select('*')
    .eq('quiz_id', quizId)
    .order('position', { ascending: true })

  if (questionsError) {
    console.error('Error fetching questions:', questionsError)
    return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
  }

  const classroomStudentsResult = await getClassroomStudentIds(supabase, quiz.classroom_id)
  if (classroomStudentsResult.error) {
    console.error('Error fetching classroom enrollments:', classroomStudentsResult.error)
    return NextResponse.json({ error: 'Failed to fetch classroom enrollments' }, { status: 500 })
  }

  const responseResult = classroomStudentsResult.studentIds.length > 0
    ? await loadQuizResponses(supabase, quizId, classroomStudentsResult.studentIds)
    : { rows: [], error: null }
  const { rows: responseRows, error: responsesError } = responseResult

  if (responsesError) {
    console.error('Error fetching responses:', responsesError)
    return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
  }

  const responses = (responseRows || []).filter((response) =>
    classroomStudentsResult.studentIdSet.has(response.student_id)
  ).sort((a, b) => a.id.localeCompare(b.id))

  const responderIds = [...new Set(responses?.map((r) => r.student_id) || [])]

  let responders: {
    student_id: string
    name: string | null
    email: string
    answers: Record<string, number>
    focus_summary: QuizFocusSummary | null
  }[] = []

  if (responderIds.length > 0) {
    const { rows: users, error: usersError } = await loadResponderUsers(supabase, responderIds)
    if (usersError) {
      console.error('Error fetching responder users:', usersError)
      return NextResponse.json({ error: 'Failed to fetch responder users' }, { status: 500 })
    }

    const { rows: profiles, error: profilesError } = await loadResponderProfiles(supabase, responderIds)
    if (profilesError) {
      console.error('Error fetching responder profiles:', profilesError)
      return NextResponse.json({ error: 'Failed to fetch responder profiles' }, { status: 500 })
    }

    const profileMap = new Map(
      profiles?.map((p) => [
        p.user_id,
        `${p.first_name || ''} ${p.last_name || ''}`.trim(),
      ]) || []
    )

    const studentAnswers: Record<string, Record<string, number>> = {}
    for (const response of responses || []) {
      if (!studentAnswers[response.student_id]) studentAnswers[response.student_id] = {}
      studentAnswers[response.student_id][response.question_id] = response.selected_option
    }

    responders = (users || []).map((u) => ({
      student_id: u.id,
      name: profileMap.get(u.id) || null,
      email: u.email,
      answers: studentAnswers[u.id] || {},
      focus_summary: null,
    }))

    responders.sort((a, b) => {
      const nameA = a.name || a.email
      const nameB = b.name || b.email
      return nameA.localeCompare(nameB) || a.student_id.localeCompare(b.student_id)
    })
  }

  const aggregated = aggregateResults(
    (questions || []) as QuizQuestion[],
    responses as QuizResponse[]
  )

  return NextResponse.json({
    quiz: {
      id: quiz.id,
      title: quiz.title,
      assessment_type: 'quiz' as const,
      status: quiz.status,
      show_results: quiz.show_results,
    },
    questions: (questions || []).map((q) => ({
      id: q.id,
      question_text: q.question_text,
      options: q.options,
      position: q.position,
    })),
    results: aggregated,
    responders,
    stats: {
      total_students: classroomStudentsResult.totalStudents,
      responded: responderIds.length,
    },
  })
})

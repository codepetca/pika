import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { aggregateResults, canStudentViewResults } from '@/lib/quizzes'
import { assertStudentCanAccessQuiz } from '@/lib/server/quizzes'
import { getClassroomStudentIds } from '@/lib/server/classrooms'
import { chunkValues, loadPagedRows } from '@/lib/server/query-chunks'
import { withErrorHandler } from '@/lib/api-handler'
import type { QuizQuestion, QuizResponse } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const STUDENT_QUIZ_RESULTS_PAGE_SIZE = 1000

type QuizOwnResponseRow = {
  id: string
  question_id: string
  selected_option: number
}

async function loadQuizQuestions(
  supabase: any,
  quizId: string
): Promise<{ rows: QuizQuestion[]; error: any }> {
  return loadPagedRows<QuizQuestion>(() =>
    supabase
      .from('quiz_questions')
      .select('*')
      .eq('quiz_id', quizId),
    STUDENT_QUIZ_RESULTS_PAGE_SIZE,
    'position'
  )
}

async function loadQuizResponsesForStudents(
  supabase: any,
  quizId: string,
  studentIds: string[]
): Promise<{ rows: QuizResponse[]; error: any }> {
  if (studentIds.length === 0) return { rows: [], error: null }

  const rows: QuizResponse[] = []
  for (const studentIdChunk of chunkValues(studentIds)) {
    const result = await loadPagedRows<QuizResponse>(() =>
      supabase
        .from('quiz_responses')
        .select('*')
        .eq('quiz_id', quizId)
        .in('student_id', studentIdChunk),
      STUDENT_QUIZ_RESULTS_PAGE_SIZE
    )

    if (result.error) return result
    rows.push(...result.rows)
  }

  return { rows, error: null }
}

async function loadQuizOwnResponses(
  supabase: any,
  quizId: string,
  studentId: string
): Promise<{ rows: QuizOwnResponseRow[]; error: any }> {
  return loadPagedRows<QuizOwnResponseRow>(() =>
    supabase
      .from('quiz_responses')
      .select('id, question_id, selected_option')
      .eq('quiz_id', quizId)
      .eq('student_id', studentId),
    STUDENT_QUIZ_RESULTS_PAGE_SIZE
  )
}

// GET /api/student/quizzes/[id]/results - Get aggregated results (if allowed)
export const GET = withErrorHandler('GetStudentQuizResults', async (request, context) => {
  const user = await requireRole('student')
  const { id: quizId } = await context.params

  const access = await assertStudentCanAccessQuiz(user.id, quizId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const quiz = access.quiz
  const supabase = getServiceRoleClient()

  // Check if student has responded
  const { data: studentResponses, error: studentResponsesError } = await supabase
    .from('quiz_responses')
    .select('id')
    .eq('quiz_id', quizId)
    .eq('student_id', user.id)
    .limit(1)

  if (studentResponsesError) {
    console.error('Error checking quiz response:', studentResponsesError)
    return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
  }

  const hasResponded = (studentResponses?.length || 0) > 0

  // Check if student can view results
  if (!canStudentViewResults(quiz, hasResponded)) {
    return NextResponse.json(
      { error: 'Results are not available for this quiz' },
      { status: 403 }
    )
  }

  const { rows: questions, error: questionsError } = await loadQuizQuestions(supabase, quizId)

  if (questionsError) {
    console.error('Error fetching questions:', questionsError)
    return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
  }

  const classroomStudentsResult = await getClassroomStudentIds(supabase, quiz.classroom_id)
  if (classroomStudentsResult.error) {
    console.error('Error fetching classroom enrollments for quiz results:', classroomStudentsResult.error)
    return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
  }

  const { rows: responses, error: responsesError } = await loadQuizResponsesForStudents(
    supabase,
    quizId,
    classroomStudentsResult.studentIds
  )

  if (responsesError) {
    console.error('Error fetching responses:', responsesError)
    return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
  }

  const scopedResponses = (responses || []).filter((response) =>
    classroomStudentsResult.studentIdSet.has(response.student_id)
  )

  // Aggregate results
  const aggregated = aggregateResults(
    (questions || []) as QuizQuestion[],
    scopedResponses as QuizResponse[]
  )

  // Get student's own responses
  const myResponses: Record<string, number> = {}
  const { rows: myResponsesData, error: myResponsesError } = await loadQuizOwnResponses(
    supabase,
    quizId,
    user.id
  )

  if (myResponsesError) {
    console.error('Error fetching student quiz responses:', myResponsesError)
    return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
  }

  for (const r of myResponsesData || []) {
    myResponses[r.question_id] = r.selected_option
  }

  return NextResponse.json({
    quiz: {
      id: quiz.id,
      title: quiz.title,
      status: quiz.status,
    },
    results: aggregated,
    my_responses: myResponses,
  })
})

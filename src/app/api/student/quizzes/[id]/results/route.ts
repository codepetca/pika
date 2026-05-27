import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { aggregateResults, canStudentViewResults } from '@/lib/quizzes'
import { assertStudentCanAccessQuiz } from '@/lib/server/quizzes'
import { getClassroomStudentIds } from '@/lib/server/classrooms'
import { withErrorHandler } from '@/lib/api-handler'
import type { QuizQuestion, QuizResponse } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

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
  const { data: studentResponses } = await supabase
    .from('quiz_responses')
    .select('id')
    .eq('quiz_id', quizId)
    .eq('student_id', user.id)
    .limit(1)

  const hasResponded = (studentResponses?.length || 0) > 0

  // Check if student can view results
  if (!canStudentViewResults(quiz, hasResponded)) {
    return NextResponse.json(
      { error: 'Results are not available for this quiz' },
      { status: 403 }
    )
  }

  // Fetch questions
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
    console.error('Error fetching classroom enrollments for quiz results:', classroomStudentsResult.error)
    return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
  }

  const { data: responses, error: responsesError } =
    classroomStudentsResult.studentIds.length > 0
      ? await supabase
          .from('quiz_responses')
          .select('*')
          .eq('quiz_id', quizId)
          .in('student_id', classroomStudentsResult.studentIds)
      : { data: [], error: null }

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
  const { data: myResponsesData } = await supabase
    .from('quiz_responses')
    .select('question_id, selected_option')
    .eq('quiz_id', quizId)
    .eq('student_id', user.id)

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

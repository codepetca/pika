import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { getQuizAssessmentType, getStudentQuizStatus } from '@/lib/quizzes'
import type { Quiz, QuizAssessmentType } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/student/quizzes?classroom_id=xxx - List quizzes for student
export async function GET(request: NextRequest) {
  try {
    const user = await requireRole('student')
    const { searchParams } = new URL(request.url)
    const classroomId = searchParams.get('classroom_id')
    const assessmentTypeParam = searchParams.get('assessment_type')

    if (!classroomId) {
      return NextResponse.json({ error: 'classroom_id is required' }, { status: 400 })
    }

    if (assessmentTypeParam && assessmentTypeParam !== 'quiz' && assessmentTypeParam !== 'test') {
      return NextResponse.json(
        { error: 'assessment_type must be "quiz" or "test"' },
        { status: 400 }
      )
    }

    const supabase = getServiceRoleClient()

    const access = await assertStudentCanAccessClassroom(user.id, classroomId)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    async function fetchByStatus(status: 'active' | 'closed', withAssessmentFilter: boolean) {
      let query = supabase
        .from('quizzes')
        .select('*')
        .eq('classroom_id', classroomId)
        .eq('status', status)

      if (withAssessmentFilter && assessmentTypeParam) {
        query = query.eq('assessment_type', assessmentTypeParam)
      }

      return query.order('position', { ascending: true })
    }

    // Fetch active quizzes/tests
    let { data: activeQuizzes, error: activeError } = await fetchByStatus('active', true)

    if (activeError?.code === '42703') {
      const fallback = await fetchByStatus('active', false)
      activeQuizzes = fallback.data || []
      activeError = fallback.error
      if (!activeError && assessmentTypeParam) {
        activeQuizzes = (activeQuizzes || []).filter((quiz) => getQuizAssessmentType(quiz) === assessmentTypeParam)
      }
    }

    if (activeError) {
      console.error('Error fetching active quizzes:', activeError)
      return NextResponse.json({ error: 'Failed to fetch quizzes' }, { status: 500 })
    }

    // Also fetch closed quizzes/tests the student has responded to
    let { data: closedQuizzes, error: closedError } = await fetchByStatus('closed', true)

    if (closedError?.code === '42703') {
      const fallback = await fetchByStatus('closed', false)
      closedQuizzes = fallback.data || []
      closedError = fallback.error
      if (!closedError && assessmentTypeParam) {
        closedQuizzes = (closedQuizzes || []).filter((quiz) => getQuizAssessmentType(quiz) === assessmentTypeParam)
      }
    }

    if (closedError) {
      console.error('Error fetching closed quizzes:', closedError)
      // Continue without closed quizzes
    }

    // Get student's responses scoped to this classroom's quizzes
    const classroomQuizIds = [
      ...(activeQuizzes || []).map((q) => q.id),
      ...(closedQuizzes || []).map((q) => q.id),
    ]
    const respondedQuizIds = new Set<string>()
    if (classroomQuizIds.length > 0) {
      const { data: allResponses } = await supabase
        .from('quiz_responses')
        .select('quiz_id')
        .eq('student_id', user.id)
        .in('quiz_id', classroomQuizIds)

      for (const r of allResponses || []) {
        respondedQuizIds.add(r.quiz_id)
      }
    }

    // Filter closed quizzes to only those the student has responded to
    const respondedClosedQuizzes = (closedQuizzes || []).filter((q) =>
      respondedQuizIds.has(q.id)
    )

    // Combine and add student status
    const allQuizzes = [...(activeQuizzes || []), ...respondedClosedQuizzes]

    const quizzesWithStatus = allQuizzes.map((quiz: Quiz) => {
      const hasResponded = respondedQuizIds.has(quiz.id)
      const studentStatus = getStudentQuizStatus(quiz, hasResponded)
      const assessmentType: QuizAssessmentType = getQuizAssessmentType(quiz)

      return {
        ...quiz,
        assessment_type: assessmentType,
        student_status: studentStatus,
      }
    })

    return NextResponse.json({ quizzes: quizzesWithStatus })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Get student quizzes error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

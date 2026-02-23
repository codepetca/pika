import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherCanMutateClassroom, assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { getQuizAssessmentType } from '@/lib/quizzes'
import type { QuizAssessmentType } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/teacher/quizzes?classroom_id=xxx - List quizzes for a classroom
export async function GET(request: NextRequest) {
  try {
    const user = await requireRole('teacher')
    const { searchParams } = new URL(request.url)
    const classroomId = searchParams.get('classroom_id')
    const assessmentTypeParam = searchParams.get('assessment_type')

    if (!classroomId) {
      return NextResponse.json(
        { error: 'classroom_id is required' },
        { status: 400 }
      )
    }

    if (assessmentTypeParam && assessmentTypeParam !== 'quiz' && assessmentTypeParam !== 'test') {
      return NextResponse.json(
        { error: 'assessment_type must be "quiz" or "test"' },
        { status: 400 }
      )
    }

    const ownership = await assertTeacherOwnsClassroom(user.id, classroomId)
    if (!ownership.ok) {
      return NextResponse.json(
        { error: ownership.error },
        { status: ownership.status }
      )
    }

    const supabase = getServiceRoleClient()

    // Fetch quizzes with questions count
    async function fetchQuizzes(withAssessmentFilter: boolean) {
      let query = supabase
        .from('quizzes')
        .select('*')
        .eq('classroom_id', classroomId)

      if (withAssessmentFilter && assessmentTypeParam) {
        query = query.eq('assessment_type', assessmentTypeParam)
      }

      return query
        .order('position', { ascending: true })
        .order('created_at', { ascending: true })
    }

    let { data: quizzes, error: quizzesError } = await fetchQuizzes(true)

    if (quizzesError?.code === '42703') {
      const fallback = await fetchQuizzes(false)
      quizzes = fallback.data || []
      quizzesError = fallback.error
      if (!quizzesError && assessmentTypeParam) {
        quizzes = (quizzes || []).filter((quiz) => getQuizAssessmentType(quiz) === assessmentTypeParam)
      }
    }

    if (quizzesError) {
      console.error('Error fetching quizzes:', quizzesError)
      return NextResponse.json({ error: 'Failed to fetch quizzes' }, { status: 500 })
    }

    // Count total students in classroom
    const { count: totalStudents } = await supabase
      .from('classroom_enrollments')
      .select('*', { count: 'exact', head: true })
      .eq('classroom_id', classroomId)

    const quizIds = (quizzes || []).map((q) => q.id)

    // Batch: count questions per quiz
    const questionCountMap: Record<string, number> = {}
    if (quizIds.length > 0) {
      const { data: questionRows } = await supabase
        .from('quiz_questions')
        .select('quiz_id')
        .in('quiz_id', quizIds)

      for (const row of questionRows || []) {
        questionCountMap[row.quiz_id] = (questionCountMap[row.quiz_id] || 0) + 1
      }
    }

    // Batch: count unique respondents per quiz
    const respondentCountMap: Record<string, number> = {}
    if (quizIds.length > 0) {
      const { data: responseRows } = await supabase
        .from('quiz_responses')
        .select('quiz_id, student_id')
        .in('quiz_id', quizIds)

      const seen: Record<string, Set<string>> = {}
      for (const row of responseRows || []) {
        if (!seen[row.quiz_id]) seen[row.quiz_id] = new Set()
        seen[row.quiz_id].add(row.student_id)
      }
      for (const [qid, students] of Object.entries(seen)) {
        respondentCountMap[qid] = students.size
      }
    }

    const quizzesWithStats = (quizzes || []).map((quiz) => ({
      ...quiz,
      assessment_type: getQuizAssessmentType(quiz),
      stats: {
        total_students: totalStudents || 0,
        responded: respondentCountMap[quiz.id] || 0,
        questions_count: questionCountMap[quiz.id] || 0,
      },
    }))

    return NextResponse.json({ quizzes: quizzesWithStats })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Get quizzes error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/teacher/quizzes - Create a new quiz
export async function POST(request: NextRequest) {
  try {
    const user = await requireRole('teacher')
    const body = await request.json()
    const { classroom_id, title, assessment_type } = body

    if (!classroom_id) {
      return NextResponse.json({ error: 'classroom_id is required' }, { status: 400 })
    }
    if (!title || !title.trim()) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }

    let assessmentType: QuizAssessmentType = 'quiz'
    if (assessment_type !== undefined) {
      if (assessment_type !== 'quiz' && assessment_type !== 'test') {
        return NextResponse.json(
          { error: 'assessment_type must be "quiz" or "test"' },
          { status: 400 }
        )
      }
      assessmentType = assessment_type
    }

    const ownership = await assertTeacherCanMutateClassroom(user.id, classroom_id)
    if (!ownership.ok) {
      return NextResponse.json(
        { error: ownership.error },
        { status: ownership.status }
      )
    }

    const supabase = getServiceRoleClient()

    // Get next position
    const { data: lastQuiz } = await supabase
      .from('quizzes')
      .select('position')
      .eq('classroom_id', classroom_id)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()

    const nextPosition = typeof lastQuiz?.position === 'number' ? lastQuiz.position + 1 : 0

    const insertPayload = {
      classroom_id,
      title: title.trim(),
      assessment_type: assessmentType,
      created_by: user.id,
      position: nextPosition,
    }

    let { data: quiz, error } = await supabase
      .from('quizzes')
      .insert(insertPayload)
      .select()
      .single()

    if (error?.code === '42703') {
      if (assessmentType === 'test') {
        return NextResponse.json(
          { error: 'Tests require migration 038 to be applied (assessment_type column missing)' },
          { status: 400 }
        )
      }

      const retry = await supabase
        .from('quizzes')
        .insert({
          classroom_id,
          title: title.trim(),
          created_by: user.id,
          position: nextPosition,
        })
        .select()
        .single()
      quiz = retry.data
      error = retry.error
    }

    if (error) {
      console.error('Error creating quiz:', error)
      return NextResponse.json({ error: 'Failed to create quiz' }, { status: 500 })
    }

    return NextResponse.json({ quiz }, { status: 201 })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Create quiz error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

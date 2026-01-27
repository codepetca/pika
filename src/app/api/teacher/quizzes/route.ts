import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherCanMutateClassroom, assertTeacherOwnsClassroom } from '@/lib/server/classrooms'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/teacher/quizzes?classroom_id=xxx - List quizzes for a classroom
export async function GET(request: NextRequest) {
  try {
    const user = await requireRole('teacher')
    const { searchParams } = new URL(request.url)
    const classroomId = searchParams.get('classroom_id')

    if (!classroomId) {
      return NextResponse.json(
        { error: 'classroom_id is required' },
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
    const { data: quizzes, error: quizzesError } = await supabase
      .from('quizzes')
      .select('*')
      .eq('classroom_id', classroomId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })

    if (quizzesError) {
      console.error('Error fetching quizzes:', quizzesError)
      return NextResponse.json({ error: 'Failed to fetch quizzes' }, { status: 500 })
    }

    // Count total students in classroom
    const { count: totalStudents } = await supabase
      .from('classroom_enrollments')
      .select('*', { count: 'exact', head: true })
      .eq('classroom_id', classroomId)

    // Get stats for each quiz
    const quizzesWithStats = await Promise.all(
      (quizzes || []).map(async (quiz) => {
        // Count questions
        const { count: questionsCount } = await supabase
          .from('quiz_questions')
          .select('*', { count: 'exact', head: true })
          .eq('quiz_id', quiz.id)

        // Count unique students who responded
        const { data: responses } = await supabase
          .from('quiz_responses')
          .select('student_id')
          .eq('quiz_id', quiz.id)

        const uniqueStudentIds = new Set(responses?.map((r) => r.student_id) || [])

        return {
          ...quiz,
          stats: {
            total_students: totalStudents || 0,
            responded: uniqueStudentIds.size,
            questions_count: questionsCount || 0,
          },
        }
      })
    )

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
    const { classroom_id, title } = body

    if (!classroom_id) {
      return NextResponse.json({ error: 'classroom_id is required' }, { status: 400 })
    }
    if (!title || !title.trim()) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
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

    const { data: quiz, error } = await supabase
      .from('quizzes')
      .insert({
        classroom_id,
        title: title.trim(),
        created_by: user.id,
        position: nextPosition,
      })
      .select()
      .single()

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

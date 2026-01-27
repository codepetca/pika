import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { aggregateResults } from '@/lib/quizzes'
import type { QuizQuestion, QuizResponse } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/teacher/quizzes/[id]/results - Get aggregated results
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id: quizId } = await params

    const supabase = getServiceRoleClient()

    // Fetch quiz and verify ownership
    const { data: quiz, error: quizError } = await supabase
      .from('quizzes')
      .select(`
        *,
        classrooms!inner (
          id,
          teacher_id
        )
      `)
      .eq('id', quizId)
      .single()

    if (quizError || !quiz) {
      return NextResponse.json({ error: 'Quiz not found' }, { status: 404 })
    }

    if (quiz.classrooms.teacher_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
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

    // Fetch all responses
    const { data: responses, error: responsesError } = await supabase
      .from('quiz_responses')
      .select('*')
      .eq('quiz_id', quizId)

    if (responsesError) {
      console.error('Error fetching responses:', responsesError)
      return NextResponse.json({ error: 'Failed to fetch responses' }, { status: 500 })
    }

    // Get unique responder IDs
    const responderIds = [...new Set(responses?.map((r) => r.student_id) || [])]

    // Get responder details (names)
    let responders: { student_id: string; name: string | null; email: string }[] = []
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
        profiles?.map((p) => [
          p.user_id,
          `${p.first_name} ${p.last_name}`.trim(),
        ]) || []
      )

      responders = (users || []).map((u) => ({
        student_id: u.id,
        name: profileMap.get(u.id) || null,
        email: u.email,
      }))

      // Sort by name (with email fallback)
      responders.sort((a, b) => {
        const nameA = a.name || a.email
        const nameB = b.name || b.email
        return nameA.localeCompare(nameB)
      })
    }

    // Aggregate results
    const aggregated = aggregateResults(
      (questions || []) as QuizQuestion[],
      (responses || []) as QuizResponse[]
    )

    // Count total students in classroom
    const { count: totalStudents } = await supabase
      .from('classroom_enrollments')
      .select('*', { count: 'exact', head: true })
      .eq('classroom_id', quiz.classroom_id)

    return NextResponse.json({
      quiz: {
        id: quiz.id,
        title: quiz.title,
        status: quiz.status,
        show_results: quiz.show_results,
      },
      results: aggregated,
      responders,
      stats: {
        total_students: totalStudents || 0,
        responded: responderIds.length,
      },
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Get quiz results error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

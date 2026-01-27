import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { canActivateQuiz } from '@/lib/quizzes'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/teacher/quizzes/[id] - Get quiz with questions
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id } = await params
    const supabase = getServiceRoleClient()

    // Fetch quiz and verify ownership
    const { data: quiz, error: quizError } = await supabase
      .from('quizzes')
      .select(`
        *,
        classrooms!inner (
          id,
          teacher_id,
          title,
          archived_at
        )
      `)
      .eq('id', id)
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
      .eq('quiz_id', id)
      .order('position', { ascending: true })

    if (questionsError) {
      console.error('Error fetching questions:', questionsError)
      return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
    }

    return NextResponse.json({
      quiz: {
        id: quiz.id,
        classroom_id: quiz.classroom_id,
        title: quiz.title,
        status: quiz.status,
        show_results: quiz.show_results,
        position: quiz.position,
        created_by: quiz.created_by,
        created_at: quiz.created_at,
        updated_at: quiz.updated_at,
      },
      questions: questions || [],
      classroom: quiz.classrooms,
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Get quiz error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/teacher/quizzes/[id] - Update quiz title/status/show_results
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id } = await params
    const body = await request.json()
    const { title, status, show_results } = body

    const supabase = getServiceRoleClient()

    // Fetch quiz and verify ownership
    const { data: existing, error: existingError } = await supabase
      .from('quizzes')
      .select(`
        *,
        classrooms!inner (
          teacher_id,
          archived_at
        )
      `)
      .eq('id', id)
      .single()

    if (existingError || !existing) {
      return NextResponse.json({ error: 'Quiz not found' }, { status: 404 })
    }

    if (existing.classrooms.teacher_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    if (existing.classrooms.archived_at) {
      return NextResponse.json({ error: 'Classroom is archived' }, { status: 403 })
    }

    // If activating quiz, validate it has questions
    if (status === 'active' && existing.status === 'draft') {
      const { count: questionsCount } = await supabase
        .from('quiz_questions')
        .select('*', { count: 'exact', head: true })
        .eq('quiz_id', id)

      const activation = canActivateQuiz(existing, questionsCount || 0)
      if (!activation.valid) {
        return NextResponse.json({ error: activation.error }, { status: 400 })
      }
    }

    // Build update object
    const updates: Record<string, any> = {}
    if (title !== undefined) updates.title = title.trim()
    if (status !== undefined) updates.status = status
    if (show_results !== undefined) updates.show_results = show_results

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
    }

    const { data: quiz, error } = await supabase
      .from('quizzes')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating quiz:', error)
      return NextResponse.json({ error: 'Failed to update quiz' }, { status: 500 })
    }

    return NextResponse.json({ quiz })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Update quiz error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/teacher/quizzes/[id] - Delete quiz
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id } = await params
    const supabase = getServiceRoleClient()

    // Fetch quiz and verify ownership
    const { data: existing, error: existingError } = await supabase
      .from('quizzes')
      .select(`
        *,
        classrooms!inner (
          teacher_id,
          archived_at
        )
      `)
      .eq('id', id)
      .single()

    if (existingError || !existing) {
      return NextResponse.json({ error: 'Quiz not found' }, { status: 404 })
    }

    if (existing.classrooms.teacher_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    if (existing.classrooms.archived_at) {
      return NextResponse.json({ error: 'Classroom is archived' }, { status: 403 })
    }

    // Count responses for confirmation warning
    const { count: responsesCount } = await supabase
      .from('quiz_responses')
      .select('*', { count: 'exact', head: true })
      .eq('quiz_id', id)

    const { error } = await supabase
      .from('quizzes')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting quiz:', error)
      return NextResponse.json({ error: 'Failed to delete quiz' }, { status: 500 })
    }

    return NextResponse.json({ success: true, responses_count: responsesCount || 0 })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Delete quiz error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { canActivateQuiz } from '@/lib/quizzes'
import { assertTeacherOwnsTest } from '@/lib/server/tests'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/teacher/tests/[id] - Get test with questions
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id } = await params
    const supabase = getServiceRoleClient()

    const access = await assertTeacherOwnsTest(user.id, id)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    const test = access.test

    const { data: questions, error: questionsError } = await supabase
      .from('test_questions')
      .select('*')
      .eq('test_id', id)
      .order('position', { ascending: true })

    if (questionsError) {
      console.error('Error fetching test questions:', questionsError)
      return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
    }

    return NextResponse.json({
      quiz: {
        id: test.id,
        classroom_id: test.classroom_id,
        title: test.title,
        assessment_type: 'test' as const,
        status: test.status,
        show_results: test.show_results,
        position: test.position,
        points_possible: test.points_possible,
        include_in_final: test.include_in_final,
        grading_finalized_at: test.grading_finalized_at,
        grading_finalized_by: test.grading_finalized_by,
        created_by: test.created_by,
        created_at: test.created_at,
        updated_at: test.updated_at,
      },
      questions: questions || [],
      classroom: test.classrooms,
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Get test error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/teacher/tests/[id] - Update test title/status/show_results
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id } = await params
    const body = await request.json()
    const { title, status, show_results } = body

    const access = await assertTeacherOwnsTest(user.id, id, { checkArchived: true })
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    const existing = access.test
    const supabase = getServiceRoleClient()

    if (status !== undefined) {
      const VALID_TRANSITIONS: Record<string, string[]> = {
        draft: ['active'],
        active: ['closed'],
        closed: ['active'],
      }
      const allowed = VALID_TRANSITIONS[existing.status] || []
      if (!allowed.includes(status)) {
        return NextResponse.json(
          { error: `Cannot transition from ${existing.status} to ${status}` },
          { status: 400 }
        )
      }
    }

    if (status === 'active' && existing.status === 'draft') {
      const { count: questionsCount } = await supabase
        .from('test_questions')
        .select('*', { count: 'exact', head: true })
        .eq('test_id', id)

      const activation = canActivateQuiz(existing, questionsCount || 0)
      if (!activation.valid) {
        return NextResponse.json({ error: activation.error }, { status: 400 })
      }
    }

    if (title !== undefined) {
      const trimmed = typeof title === 'string' ? title.trim() : ''
      if (!trimmed) {
        return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 })
      }
    }

    if (show_results !== undefined && typeof show_results !== 'boolean') {
      return NextResponse.json({ error: 'show_results must be a boolean' }, { status: 400 })
    }

    const updates: Record<string, any> = {}
    if (title !== undefined) updates.title = title.trim()
    if (status !== undefined) updates.status = status
    if (show_results !== undefined) updates.show_results = show_results
    if (status !== undefined && status !== existing.status) {
      updates.grading_finalized_at = null
      updates.grading_finalized_by = null
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
    }

    const { data: test, error } = await supabase
      .from('tests')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating test:', error)
      return NextResponse.json({ error: 'Failed to update test' }, { status: 500 })
    }

    return NextResponse.json({ quiz: { ...test, assessment_type: 'test' } })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Update test error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/teacher/tests/[id] - Delete test
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id } = await params

    const access = await assertTeacherOwnsTest(user.id, id, { checkArchived: true })
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    const supabase = getServiceRoleClient()

    const { count: responsesCount } = await supabase
      .from('test_responses')
      .select('*', { count: 'exact', head: true })
      .eq('test_id', id)

    const { error } = await supabase
      .from('tests')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting test:', error)
      return NextResponse.json({ error: 'Failed to delete test' }, { status: 500 })
    }

    return NextResponse.json({ success: true, responses_count: responsesCount || 0 })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Delete test error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

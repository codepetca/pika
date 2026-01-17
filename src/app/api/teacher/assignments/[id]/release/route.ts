import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/assignments/[id]/release - Release a draft assignment to students
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id } = await params
    const supabase = getServiceRoleClient()

    // Fetch assignment and verify ownership
    const { data: existing, error: existingError } = await supabase
      .from('assignments')
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
      return NextResponse.json(
        { error: 'Assignment not found' },
        { status: 404 }
      )
    }

    if (existing.classrooms.teacher_id !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    if (existing.classrooms.archived_at) {
      return NextResponse.json(
        { error: 'Classroom is archived' },
        { status: 403 }
      )
    }

    // Check if already released
    if (!existing.is_draft) {
      return NextResponse.json(
        { error: 'Assignment is already released' },
        { status: 400 }
      )
    }

    // Release the assignment
    const { data: assignment, error } = await supabase
      .from('assignments')
      .update({
        is_draft: false,
        released_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error releasing assignment:', error)
      return NextResponse.json(
        { error: 'Failed to release assignment' },
        { status: 500 }
      )
    }

    return NextResponse.json({ assignment })
  } catch (error: any) {
    // Authentication error (401)
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Authorization error (403)
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // All other errors (500)
    console.error('Release assignment error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

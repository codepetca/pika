import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/teacher/classrooms/[id] - Get classroom details
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireRole('teacher')
    const classroomId = params.id

    const supabase = getServiceRoleClient()

    // Fetch classroom
    const { data: classroom, error: fetchError } = await supabase
      .from('classrooms')
      .select('*')
      .eq('id', classroomId)
      .single()

    if (fetchError || !classroom) {
      return NextResponse.json(
        { error: 'Classroom not found' },
        { status: 404 }
      )
    }

    // Verify ownership
    if (classroom.teacher_id !== user.id) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      )
    }

    return NextResponse.json({ classroom })
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
    console.error('Get classroom error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// PATCH /api/teacher/classrooms/[id] - Update classroom
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Parse request body
  const body = await request.json()
  const { title, classCode, termLabel } = body

  // Validate: at least one field must be provided
  if (title === undefined && classCode === undefined && termLabel === undefined) {
    return NextResponse.json(
      { error: 'No fields to update' },
      { status: 400 }
    )
  }

  try {
    const user = await requireRole('teacher')
    const classroomId = params.id

    const supabase = getServiceRoleClient()

    // Verify ownership
    const { data: classroom, error: fetchError } = await supabase
      .from('classrooms')
      .select('teacher_id')
      .eq('id', classroomId)
      .single()

    if (fetchError || !classroom) {
      return NextResponse.json(
        { error: 'Classroom not found' },
        { status: 404 }
      )
    }

    if (classroom.teacher_id !== user.id) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      )
    }

    // Update classroom
    const updates: any = {}
    if (title !== undefined) updates.title = title
    if (classCode !== undefined) updates.class_code = classCode
    if (termLabel !== undefined) updates.term_label = termLabel

    const { data: updatedClassroom, error: updateError } = await supabase
      .from('classrooms')
      .update(updates)
      .eq('id', classroomId)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating classroom:', updateError)
      return NextResponse.json(
        { error: 'Failed to update classroom' },
        { status: 500 }
      )
    }

    return NextResponse.json({ classroom: updatedClassroom })
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
    console.error('Update classroom error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// DELETE /api/teacher/classrooms/[id] - Delete classroom
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireRole('teacher')
    const classroomId = params.id

    const supabase = getServiceRoleClient()

    // Verify ownership
    const { data: classroom, error: fetchError } = await supabase
      .from('classrooms')
      .select('teacher_id')
      .eq('id', classroomId)
      .single()

    if (fetchError || !classroom) {
      return NextResponse.json(
        { error: 'Classroom not found' },
        { status: 404 }
      )
    }

    if (classroom.teacher_id !== user.id) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      )
    }

    // Delete classroom (cascades to enrollments, class_days, entries)
    const { error: deleteError } = await supabase
      .from('classrooms')
      .delete()
      .eq('id', classroomId)

    if (deleteError) {
      console.error('Error deleting classroom:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete classroom' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
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
    console.error('Delete classroom error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

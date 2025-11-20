import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// PATCH /api/teacher/classrooms/[id] - Update classroom
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireRole('teacher')
    const classroomId = params.id
    const body = await request.json()
    const { title, classCode, termLabel } = body

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
    console.error('Update classroom error:', error)
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: 401 }
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
    console.error('Delete classroom error:', error)
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: 401 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherOwnsClassroom } from '@/lib/server/classrooms'

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
  const { title, classCode, termLabel, allowEnrollment, archived, lessonPlanVisibility } = body

  // Validate: at least one field must be provided
  if (
    title === undefined &&
    classCode === undefined &&
    termLabel === undefined &&
    allowEnrollment === undefined &&
    archived === undefined &&
    lessonPlanVisibility === undefined
  ) {
    return NextResponse.json(
      { error: 'No fields to update' },
      { status: 400 }
    )
  }

  // Validate lessonPlanVisibility if provided
  const validVisibilityValues = ['current_week', 'one_week_ahead', 'all']
  if (lessonPlanVisibility !== undefined && !validVisibilityValues.includes(lessonPlanVisibility)) {
    return NextResponse.json(
      { error: 'Invalid lessonPlanVisibility value' },
      { status: 400 }
    )
  }

  try {
    const user = await requireRole('teacher')
    const classroomId = params.id

    const supabase = getServiceRoleClient()

    if (archived !== undefined && typeof archived !== 'boolean') {
      return NextResponse.json(
        { error: 'archived must be a boolean' },
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

    const isArchived = !!ownership.classroom.archived_at
    const hasArchiveToggle = archived !== undefined
    const hasOtherUpdates =
      title !== undefined ||
      classCode !== undefined ||
      termLabel !== undefined ||
      allowEnrollment !== undefined ||
      lessonPlanVisibility !== undefined

    if (hasArchiveToggle && hasOtherUpdates) {
      return NextResponse.json(
        { error: 'Unarchive before updating classroom details' },
        { status: 400 }
      )
    }

    if (isArchived && hasOtherUpdates) {
      return NextResponse.json(
        { error: 'Classroom is archived' },
        { status: 403 }
      )
    }

    // Update classroom
    const updates: any = {}
    if (title !== undefined) updates.title = title
    if (classCode !== undefined) updates.class_code = classCode
    if (termLabel !== undefined) updates.term_label = termLabel
    if (allowEnrollment !== undefined) updates.allow_enrollment = !!allowEnrollment
    if (lessonPlanVisibility !== undefined) updates.lesson_plan_visibility = lessonPlanVisibility
    if (hasArchiveToggle) {
      if (archived && isArchived) {
        return NextResponse.json(
          { error: 'Classroom is already archived' },
          { status: 400 }
        )
      }
      if (!archived && !isArchived) {
        return NextResponse.json(
          { error: 'Classroom is not archived' },
          { status: 400 }
        )
      }
      updates.archived_at = archived ? new Date().toISOString() : null
    }

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

    const ownership = await assertTeacherOwnsClassroom(user.id, classroomId)
    if (!ownership.ok) {
      return NextResponse.json(
        { error: ownership.error },
        { status: ownership.status }
      )
    }

    if (!ownership.classroom.archived_at) {
      return NextResponse.json(
        { error: 'Classroom must be archived before deletion' },
        { status: 400 }
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

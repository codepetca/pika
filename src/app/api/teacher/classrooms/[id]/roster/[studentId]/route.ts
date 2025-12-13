import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// DELETE /api/teacher/classrooms/[id]/roster/[studentId] - Remove student from roster
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; studentId: string } }
) {
  try {
    const user = await requireRole('teacher')
    const classroomId = params.id
    const studentId = params.studentId

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

    // Remove student classroom data (logs + assignment docs) and then remove enrollment.
    // We keep the user account and student profile intact so they can be re-added later.

    const { error: entryDeleteError } = await supabase
      .from('entries')
      .delete()
      .eq('classroom_id', classroomId)
      .eq('student_id', studentId)

    if (entryDeleteError) {
      console.error('Error deleting student entries:', entryDeleteError)
      return NextResponse.json(
        { error: 'Failed to delete student entries' },
        { status: 500 }
      )
    }

    const { data: assignments, error: assignmentsError } = await supabase
      .from('assignments')
      .select('id')
      .eq('classroom_id', classroomId)

    if (assignmentsError) {
      console.error('Error fetching classroom assignments:', assignmentsError)
      return NextResponse.json(
        { error: 'Failed to fetch classroom assignments' },
        { status: 500 }
      )
    }

    const assignmentIds = (assignments || []).map(a => a.id)
    if (assignmentIds.length > 0) {
      const { error: docsDeleteError } = await supabase
        .from('assignment_docs')
        .delete()
        .eq('student_id', studentId)
        .in('assignment_id', assignmentIds)

      if (docsDeleteError) {
        console.error('Error deleting student assignment docs:', docsDeleteError)
        return NextResponse.json(
          { error: 'Failed to delete student assignment docs' },
          { status: 500 }
        )
      }
    }

    const { error: deleteError } = await supabase
      .from('classroom_enrollments')
      .delete()
      .eq('classroom_id', classroomId)
      .eq('student_id', studentId)

    if (deleteError) {
      console.error('Error removing student enrollment:', deleteError)
      return NextResponse.json(
        { error: 'Failed to remove student' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Remove student error:', error)
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: 401 }
    )
  }
}

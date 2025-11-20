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

    // Remove enrollment (preserves historical entries)
    const { error: deleteError } = await supabase
      .from('classroom_enrollments')
      .delete()
      .eq('classroom_id', classroomId)
      .eq('student_id', studentId)

    if (deleteError) {
      console.error('Error removing student:', deleteError)
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

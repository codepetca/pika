import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// GET /api/teacher/classrooms/[id]/roster - Get classroom roster
export async function GET(
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

    // Get roster with student profiles
    const { data: enrollments, error: rosterError } = await supabase
      .from('classroom_enrollments')
      .select(`
        id,
        student_id,
        created_at,
        student_profiles!inner(
          id,
          first_name,
          last_name,
          student_number,
          user_id
        ),
        users!classroom_enrollments_student_id_fkey(
          email
        )
      `)
      .eq('classroom_id', classroomId)

    if (rosterError) {
      console.error('Error fetching roster:', rosterError)
      return NextResponse.json(
        { error: 'Failed to fetch roster' },
        { status: 500 }
      )
    }

    return NextResponse.json({ roster: enrollments })
  } catch (error: any) {
    console.error('Get roster error:', error)
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: 401 }
    )
  }
}

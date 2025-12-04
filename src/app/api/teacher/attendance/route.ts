import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { computeAttendanceRecords } from '@/lib/attendance'

/**
 * GET /api/teacher/attendance?classroom_id=xxx
 * Fetches attendance data for all students in a classroom
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireRole('teacher')

    const { searchParams } = new URL(request.url)
    const classroomId = searchParams.get('classroom_id')

    if (!classroomId) {
      return NextResponse.json(
        { error: 'classroom_id is required' },
        { status: 400 }
      )
    }

    const supabase = getServiceRoleClient()

    // Verify ownership
    const { data: classroom, error: classroomError } = await supabase
      .from('classrooms')
      .select('teacher_id')
      .eq('id', classroomId)
      .single()

    if (classroomError || !classroom) {
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

    // Fetch class days for this classroom
    const { data: classDays, error: classDaysError } = await supabase
      .from('class_days')
      .select('*')
      .eq('classroom_id', classroomId)
      .order('date', { ascending: true })

    if (classDaysError) {
      console.error('Error fetching class days:', classDaysError)
      return NextResponse.json(
        { error: 'Failed to fetch class days' },
        { status: 500 }
      )
    }

    // Fetch enrolled students
    const { data: enrollments, error: enrollmentsError } = await supabase
      .from('classroom_enrollments')
      .select(`
        student_id,
        users!classroom_enrollments_student_id_fkey(
          id,
          email
        )
      `)
      .eq('classroom_id', classroomId)

    if (enrollmentsError) {
      console.error('Error fetching enrollments:', enrollmentsError)
      return NextResponse.json(
        { error: 'Failed to fetch students' },
        { status: 500 }
      )
    }

    const students = (enrollments || []).map(e => {
      const user = e.users as unknown as { id: string; email: string }
      return {
        id: user.id,
        email: user.email,
      }
    }).sort((a, b) => a.email.localeCompare(b.email))

    // Fetch all entries for this classroom
    const { data: entries, error: entriesError } = await supabase
      .from('entries')
      .select('*')
      .eq('classroom_id', classroomId)

    if (entriesError) {
      console.error('Error fetching entries:', entriesError)
      return NextResponse.json(
        { error: 'Failed to fetch entries' },
        { status: 500 }
      )
    }

    // Compute attendance records
    const attendanceRecords = computeAttendanceRecords(
      students,
      classDays || [],
      entries || []
    )

    // Get sorted list of class day dates
    const dates = (classDays || [])
      .filter(day => day.is_class_day)
      .map(day => day.date)

    return NextResponse.json({
      attendance: attendanceRecords,
      dates,
      classroom_id: classroomId,
    })
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
    console.error('Get attendance error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

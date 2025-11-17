import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { computeAttendanceRecords } from '@/lib/attendance'

/**
 * GET /api/teacher/attendance?course_code=GLD2O
 * Fetches attendance data for all students in a course
 */
export async function GET(request: NextRequest) {
  try {
    await requireRole('teacher')

    const { searchParams } = new URL(request.url)
    const courseCode = searchParams.get('course_code')

    if (!courseCode) {
      return NextResponse.json(
        { error: 'course_code is required' },
        { status: 400 }
      )
    }

    const supabase = getServiceRoleClient()

    // Fetch class days for this course
    const { data: classDays, error: classDaysError } = await supabase
      .from('class_days')
      .select('*')
      .eq('course_code', courseCode)
      .order('date', { ascending: true })

    if (classDaysError) {
      console.error('Error fetching class days:', classDaysError)
      return NextResponse.json(
        { error: 'Failed to fetch class days' },
        { status: 500 }
      )
    }

    // Fetch all students
    const { data: students, error: studentsError } = await supabase
      .from('users')
      .select('id, email')
      .eq('role', 'student')
      .order('email', { ascending: true })

    if (studentsError) {
      console.error('Error fetching students:', studentsError)
      return NextResponse.json(
        { error: 'Failed to fetch students' },
        { status: 500 }
      )
    }

    // Fetch all entries for this course
    const { data: entries, error: entriesError } = await supabase
      .from('entries')
      .select('*')
      .eq('course_code', courseCode)

    if (entriesError) {
      console.error('Error fetching entries:', entriesError)
      return NextResponse.json(
        { error: 'Failed to fetch entries' },
        { status: 500 }
      )
    }

    // Compute attendance records
    const attendanceRecords = computeAttendanceRecords(
      students || [],
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
      course_code: courseCode,
    })
  } catch (error: any) {
    if (error.message.includes('Forbidden') || error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    console.error('Get attendance error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

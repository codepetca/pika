import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { computeAttendanceRecords } from '@/lib/attendance'

/**
 * GET /api/teacher/export-csv?course_code=GLD2O
 * Exports attendance data as CSV
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

    // Fetch class days
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

    // Fetch students
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

    // Fetch entries
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

    // Compute attendance
    const attendanceRecords = computeAttendanceRecords(
      students || [],
      classDays || [],
      entries || []
    )

    // Get sorted dates (only class days)
    const dates = (classDays || [])
      .filter(day => day.is_class_day)
      .map(day => day.date)

    // Build CSV
    let csv = 'Student Email,Present,Late,Absent'

    // Add date columns
    dates.forEach(date => {
      csv += `,${date}`
    })
    csv += '\n'

    // Add rows for each student
    attendanceRecords.forEach(record => {
      csv += `${record.student_email},${record.summary.present},${record.summary.late},${record.summary.absent}`

      // Add attendance status for each date
      dates.forEach(date => {
        const status = record.dates[date]
        let symbol = ''

        if (status === 'present') symbol = 'P'
        else if (status === 'late') symbol = 'L'
        else if (status === 'absent') symbol = 'A'

        csv += `,${symbol}`
      })

      csv += '\n'
    })

    // Return CSV file
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="attendance-${courseCode}-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    })
  } catch (error: any) {
    if (error.message.includes('Forbidden') || error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    console.error('Export CSV error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

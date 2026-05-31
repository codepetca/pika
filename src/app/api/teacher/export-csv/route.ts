import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { computeAttendanceRecords } from '@/lib/attendance'
import { getTodayInToronto } from '@/lib/timezone'
import { withErrorHandler } from '@/lib/api-handler'
import {
  loadAttendanceClassDays,
  loadAttendanceEntries,
  loadAttendanceRoster,
} from '@/lib/server/attendance-report'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/teacher/export-csv?classroom_id=xxx
 * Exports attendance data as CSV
 */
export const GET = withErrorHandler('GetTeacherExportCsv', async (request, context) => {
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
    .select('teacher_id, title')
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

  const { rows: classDays, error: classDaysError } = await loadAttendanceClassDays(supabase, classroomId)

  if (classDaysError) {
    console.error('Error fetching class days:', classDaysError)
    return NextResponse.json(
      { error: 'Failed to fetch class days' },
      { status: 500 }
    )
  }

  const rosterResult = await loadAttendanceRoster(supabase, classroomId)
  if (rosterResult.enrollmentsError) {
    console.error('Error fetching enrollments:', rosterResult.enrollmentsError)
    return NextResponse.json(
      { error: 'Failed to fetch students' },
      { status: 500 }
    )
  }

  if (rosterResult.profilesError) {
    console.error('Error fetching student profiles:', rosterResult.profilesError)
    return NextResponse.json(
      { error: 'Failed to fetch student profiles' },
      { status: 500 }
    )
  }

  const { rows: entries, error: entriesError } = await loadAttendanceEntries(
    supabase,
    classroomId,
    rosterResult.studentIds
  )

  if (entriesError) {
    console.error('Error fetching entries:', entriesError)
    return NextResponse.json(
      { error: 'Failed to fetch entries' },
      { status: 500 }
    )
  }

  // Compute attendance
  const today = getTodayInToronto()
  const attendanceRecords = computeAttendanceRecords(
    rosterResult.students,
    classDays,
    entries,
    today
  )

  // Get sorted dates (only class days)
  const dates = classDays
    .filter(day => day.is_class_day)
    .map(day => day.date)

  // Build CSV
  let csv = 'Student Email,Present,Absent'

  // Add date columns
  dates.forEach(date => {
    csv += `,${date}`
  })
  csv += '\n'

  // Add rows for each student
  attendanceRecords.forEach(record => {
    csv += `${record.student_email},${record.summary.present},${record.summary.absent}`

    // Add attendance status for each date
    dates.forEach(date => {
      const status = record.dates[date]
      let symbol = ''

      if (status === 'present') symbol = 'P'
      else if (status === 'absent') symbol = 'A'

      csv += `,${symbol}`
    })

    csv += '\n'
  })

  // Return CSV file
  const filename = `attendance-${classroom.title.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.csv`
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
})

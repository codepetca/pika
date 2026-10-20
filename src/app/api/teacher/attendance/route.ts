import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { computeAttendanceRecords } from '@/lib/attendance'
import { getTodayInToronto } from '@/lib/timezone'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import {
  loadAttendanceClassDays,
  loadAttendanceEntries,
  loadAttendanceRoster,
} from '@/lib/server/attendance-report'
import { assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { authorizeSharedAttendancePolicyActor } from '@/lib/server/contextual-attendance-policy'
import { attendanceReportQuerySchema, loadContextualAttendanceReport } from '@/lib/server/contextual-attendance-report'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/teacher/attendance?classroom_id=xxx
 * Fetches attendance data for all students in a classroom
 */
export const GET = withErrorHandler('GetAttendance', async (request: NextRequest) => {
  const admission = await authorizeSharedAttendancePolicyActor()
  if (admission.mode === 'shared') {
    const input = attendanceReportQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    return NextResponse.json(await loadContextualAttendanceReport({
      supabase:getServiceRoleClient(),actorId:admission.user.id,classroomId:input.classroom_id,
    }))
  }
  const user = await requireRole('teacher')

  const { searchParams } = new URL(request.url)
  const classroomId = searchParams.get('classroom_id')

  if (!classroomId) {
    throw new ApiError(400, 'classroom_id is required')
  }

  const supabase = getServiceRoleClient()
  const ownership = await assertTeacherOwnsClassroom(user.id, classroomId, { supabase })
  if (!ownership.ok) {
    throw new ApiError(ownership.status, ownership.error)
  }

  const { rows: classDays, error: classDaysError } = await loadAttendanceClassDays(supabase, classroomId)

  if (classDaysError) {
    console.error('Error fetching class days:', classDaysError)
    throw new ApiError(500, 'Failed to fetch class days')
  }

  const rosterResult = await loadAttendanceRoster(supabase, classroomId)
  if (rosterResult.enrollmentsError) {
    console.error('Error fetching enrollments:', rosterResult.enrollmentsError)
    throw new ApiError(500, 'Failed to fetch students')
  }

  if (rosterResult.profilesError) {
    console.error('Error fetching student profiles:', rosterResult.profilesError)
    throw new ApiError(500, 'Failed to fetch student profiles')
  }

  const { rows: entries, error: entriesError } = await loadAttendanceEntries(
    supabase,
    classroomId,
    rosterResult.studentIds
  )

  if (entriesError) {
    console.error('Error fetching entries:', entriesError)
    throw new ApiError(500, 'Failed to fetch entries')
  }

  // Compute attendance records
  const today = getTodayInToronto()
  const attendanceRecords = computeAttendanceRecords(
    rosterResult.students,
    classDays,
    entries,
    today
  )

  // Get sorted list of class day dates
  const dates = classDays
    .filter(day => day.is_class_day)
    .map(day => day.date)

  return NextResponse.json({
    attendance: attendanceRecords,
    dates,
    classroom_id: classroomId,
  })
})

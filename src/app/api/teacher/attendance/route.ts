import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { computeAttendanceRecords } from '@/lib/attendance'
import { getTodayInToronto } from '@/lib/timezone'
import { withErrorHandler, ApiError } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/teacher/attendance?classroom_id=xxx
 * Fetches attendance data for all students in a classroom
 */
export const GET = withErrorHandler('GetAttendance', async (request: NextRequest) => {
  const user = await requireRole('teacher')

  const { searchParams } = new URL(request.url)
  const classroomId = searchParams.get('classroom_id')

  if (!classroomId) {
    throw new ApiError(400, 'classroom_id is required')
  }

  const supabase = getServiceRoleClient()

  // Verify ownership
  const { data: classroom, error: classroomError } = await supabase
    .from('classrooms')
    .select('teacher_id')
    .eq('id', classroomId)
    .single()

  if (classroomError || !classroom) {
    throw new ApiError(404, 'Classroom not found')
  }

  if (classroom.teacher_id !== user.id) {
    throw new ApiError(403, 'Forbidden')
  }

  // Fetch class days for this classroom
  const { data: classDays, error: classDaysError } = await supabase
    .from('class_days')
    .select('*')
    .eq('classroom_id', classroomId)
    .order('date', { ascending: true })

  if (classDaysError) {
    console.error('Error fetching class days:', classDaysError)
    throw new ApiError(500, 'Failed to fetch class days')
  }

  // Fetch enrolled students with profiles
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
    throw new ApiError(500, 'Failed to fetch students')
  }

  // Fetch student profiles
  const studentIds = (enrollments || []).map(e => e.student_id)
  const { data: profiles, error: profilesError } = await supabase
    .from('student_profiles')
    .select('user_id, first_name, last_name')
    .in('user_id', studentIds)

  if (profilesError) {
    console.error('Error fetching student profiles:', profilesError)
  }

  const profileMap = new Map(
    (profiles || []).map(p => [p.user_id, p])
  )

  const students = (enrollments || []).map(e => {
    const enrolledUser = e.users as unknown as { id: string; email: string }
    const profile = profileMap.get(enrolledUser.id)
    return {
      id: enrolledUser.id,
      email: enrolledUser.email,
      first_name: profile?.first_name || '',
      last_name: profile?.last_name || '',
    }
  }).sort((a, b) => a.email.localeCompare(b.email))

  // Fetch all entries for this classroom
  const { data: entries, error: entriesError } = await supabase
    .from('entries')
    .select('*')
    .eq('classroom_id', classroomId)

  if (entriesError) {
    console.error('Error fetching entries:', entriesError)
    throw new ApiError(500, 'Failed to fetch entries')
  }

  // Compute attendance records
  const today = getTodayInToronto()
  const attendanceRecords = computeAttendanceRecords(
    students,
    classDays || [],
    entries || [],
    today
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
})

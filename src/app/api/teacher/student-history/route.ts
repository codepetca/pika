import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { teacherStudentHistoryQuerySchema } from '@/lib/validations/teacher-student-history'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/teacher/student-history?classroom_id=xxx&student_id=xxx&before_date=YYYY-MM-DD&limit=10
 * Returns entries for a student in reverse chronological order, optionally for one exact date.
 */
export const GET = withErrorHandler('GetStudentHistory', async (request: NextRequest) => {
  const user = await requireRole('teacher')
  const { searchParams } = new URL(request.url)
  const queryInput = teacherStudentHistoryQuerySchema.parse({
    classroom_id: searchParams.get('classroom_id') ?? undefined,
    student_id: searchParams.get('student_id') ?? undefined,
    before_date: searchParams.get('before_date') ?? undefined,
    date: searchParams.get('date') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
  })
  const {
    classroom_id: classroomId,
    student_id: studentId,
    before_date: beforeDate,
    date,
    limit,
  } = queryInput

  const supabase = getServiceRoleClient()
  const ownership = await assertTeacherOwnsClassroom(user.id, classroomId, { supabase })
  if (!ownership.ok) {
    return NextResponse.json(
      { error: ownership.error },
      { status: ownership.status }
    )
  }

  // Verify student is enrolled in the classroom
  const { data: enrollment, error: enrollmentError } = await supabase
    .from('classroom_enrollments')
    .select('student_id')
    .eq('classroom_id', classroomId)
    .eq('student_id', studentId)
    .single()

  if (enrollmentError || !enrollment) {
    return NextResponse.json(
      { error: 'Student not found in classroom' },
      { status: 404 }
    )
  }

  let entriesQuery = supabase
    .from('entries')
    .select('*')
    .eq('student_id', studentId)
    .eq('classroom_id', classroomId)

  if (date) {
    entriesQuery = entriesQuery.eq('date', date)
  } else if (beforeDate) {
    entriesQuery = entriesQuery.lt('date', beforeDate)
  }

  const { data: entries, error: entriesError } = await entriesQuery
    .order('date', { ascending: false })
    .limit(limit)

  if (entriesError) {
    console.error('Error fetching student history:', entriesError)
    return NextResponse.json(
      { error: 'Failed to fetch entries' },
      { status: 500 }
    )
  }

  return NextResponse.json({ entries: entries || [] })
})

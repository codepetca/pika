import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertTeacherOwnsClassroom } from '@/lib/server/classrooms'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/teacher/student-history?classroom_id=xxx&student_id=xxx&before_date=YYYY-MM-DD&limit=10
 * Returns past entries for a student in reverse chronological order.
 */
export const GET = withErrorHandler('GetStudentHistory', async (request: NextRequest) => {
  const user = await requireRole('teacher')
  const { searchParams } = new URL(request.url)
  const classroomId = searchParams.get('classroom_id')
  const studentId = searchParams.get('student_id')
  const beforeDate = searchParams.get('before_date')
  const limit = Math.min(parseInt(searchParams.get('limit') || '10', 10) || 10, 50)

  if (!classroomId || !studentId) {
    return NextResponse.json(
      { error: 'classroom_id and student_id are required' },
      { status: 400 }
    )
  }

  if (beforeDate && !/^\d{4}-\d{2}-\d{2}$/.test(beforeDate)) {
    return NextResponse.json(
      { error: 'Invalid before_date format (use YYYY-MM-DD)' },
      { status: 400 }
    )
  }

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

  let query = supabase
    .from('entries')
    .select('*')
    .eq('student_id', studentId)
    .eq('classroom_id', classroomId)
    .order('date', { ascending: false })
    .limit(limit)

  if (beforeDate) {
    query = query.lt('date', beforeDate)
  }

  const { data: entries, error: entriesError } = await query

  if (entriesError) {
    console.error('Error fetching student history:', entriesError)
    return NextResponse.json(
      { error: 'Failed to fetch entries' },
      { status: 500 }
    )
  }

  return NextResponse.json({ entries: entries || [] })
})

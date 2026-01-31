import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/teacher/student-history?classroom_id=xxx&student_id=xxx&before_date=YYYY-MM-DD&limit=10
 * Returns past entries for a student in reverse chronological order.
 */
export async function GET(request: NextRequest) {
  try {
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
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    console.error('Get student history error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

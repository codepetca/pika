import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { getTodayInToronto } from '@/lib/timezone'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/student/notifications?classroom_id=xxx
 * Returns notification state for the student sidebar:
 * - hasTodayEntry: whether student has saved any content for today
 * - unviewedAssignmentsCount: count of assignments not yet viewed
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireRole('student')
    const { searchParams } = new URL(request.url)
    const classroomId = searchParams.get('classroom_id')

    if (!classroomId) {
      return NextResponse.json(
        { error: 'classroom_id is required' },
        { status: 400 }
      )
    }

    const supabase = getServiceRoleClient()

    const access = await assertStudentCanAccessClassroom(user.id, classroomId)
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error },
        { status: access.status }
      )
    }

    const today = getTodayInToronto()

    // Check if entry exists for today
    const { data: todayEntry, error: entryError } = await supabase
      .from('entries')
      .select('id')
      .eq('student_id', user.id)
      .eq('classroom_id', classroomId)
      .eq('date', today)
      .maybeSingle()

    if (entryError) {
      console.error('Error checking today entry:', entryError)
      return NextResponse.json(
        { error: 'Failed to check notifications' },
        { status: 500 }
      )
    }

    // Get assignments with their docs for this student in a single query
    // Using Supabase's foreign key relation to LEFT JOIN assignment_docs
    const { data: assignments, error: assignmentsError } = await supabase
      .from('assignments')
      .select(`
        id,
        assignment_docs!left(viewed_at)
      `)
      .eq('classroom_id', classroomId)
      .eq('assignment_docs.student_id', user.id)

    if (assignmentsError) {
      console.error('Error fetching assignments:', assignmentsError)
      return NextResponse.json(
        { error: 'Failed to check notifications' },
        { status: 500 }
      )
    }

    // Count unviewed: no doc exists OR doc.viewed_at is null
    let unviewedCount = 0
    for (const assignment of assignments || []) {
      const docs = assignment.assignment_docs as Array<{ viewed_at: string | null }> | null
      // No doc for this student, or doc exists but viewed_at is null
      if (!docs || docs.length === 0 || docs[0]?.viewed_at === null) {
        unviewedCount++
      }
    }

    return NextResponse.json({
      hasTodayEntry: todayEntry !== null,
      unviewedAssignmentsCount: unviewedCount,
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    console.error('Get notifications error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

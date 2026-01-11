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

    // Get all assignments for this classroom
    const { data: assignments, error: assignmentsError } = await supabase
      .from('assignments')
      .select('id')
      .eq('classroom_id', classroomId)

    if (assignmentsError) {
      console.error('Error fetching assignments:', assignmentsError)
      return NextResponse.json(
        { error: 'Failed to check notifications' },
        { status: 500 }
      )
    }

    const assignmentIds = assignments?.map(a => a.id) || []

    // Get student's docs for these assignments (only need id, assignment_id, viewed_at)
    let unviewedCount = 0

    if (assignmentIds.length > 0) {
      const { data: docs, error: docsError } = await supabase
        .from('assignment_docs')
        .select('assignment_id, viewed_at')
        .eq('student_id', user.id)
        .in('assignment_id', assignmentIds)

      if (docsError) {
        console.error('Error fetching assignment docs:', docsError)
        return NextResponse.json(
          { error: 'Failed to check notifications' },
          { status: 500 }
        )
      }

      const docMap = new Map(docs?.map(d => [d.assignment_id, d]) || [])

      // Count unviewed: no doc exists OR doc.viewed_at is null
      for (const assignmentId of assignmentIds) {
        const doc = docMap.get(assignmentId)
        if (!doc || doc.viewed_at === null) {
          unviewedCount++
        }
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

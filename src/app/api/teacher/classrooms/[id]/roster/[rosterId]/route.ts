import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// DELETE /api/teacher/classrooms/[id]/roster/[rosterId] - Remove roster entry (and enrollment if joined)
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; rosterId: string } }
) {
  try {
    const user = await requireRole('teacher')
    const classroomId = params.id
    const rosterId = params.rosterId

    const supabase = getServiceRoleClient()

    const ownership = await assertTeacherCanMutateClassroom(user.id, classroomId)
    if (!ownership.ok) {
      return NextResponse.json(
        { error: ownership.error },
        { status: ownership.status }
      )
    }

    const { data: rosterEntry, error: rosterFetchError } = await supabase
      .from('classroom_roster')
      .select('id, email')
      .eq('id', rosterId)
      .eq('classroom_id', classroomId)
      .single()

    if (rosterFetchError || !rosterEntry) {
      return NextResponse.json(
        { error: 'Roster entry not found' },
        { status: 404 }
      )
    }

    const email = String(rosterEntry.email || '').toLowerCase().trim()

    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single()

    // If the user exists, remove classroom data (logs + assignment docs) and enrollment.
    // We keep the user account intact so they can still sign in (and be re-added later).
    const studentId = existingUser?.id ?? null

    if (studentId) {
      const { error: entryDeleteError } = await supabase
        .from('entries')
        .delete()
        .eq('classroom_id', classroomId)
        .eq('student_id', studentId)

      if (entryDeleteError) {
        console.error('Error deleting student entries:', entryDeleteError)
        return NextResponse.json(
          { error: 'Failed to delete student entries' },
          { status: 500 }
        )
      }

      const { data: assignments, error: assignmentsError } = await supabase
        .from('assignments')
        .select('id')
        .eq('classroom_id', classroomId)

      if (assignmentsError) {
        console.error('Error fetching classroom assignments:', assignmentsError)
        return NextResponse.json(
          { error: 'Failed to fetch classroom assignments' },
          { status: 500 }
        )
      }

      const assignmentIds = (assignments || []).map(a => a.id)
      if (assignmentIds.length > 0) {
        const { error: docsDeleteError } = await supabase
          .from('assignment_docs')
          .delete()
          .eq('student_id', studentId)
          .in('assignment_id', assignmentIds)

        if (docsDeleteError) {
          console.error('Error deleting student assignment docs:', docsDeleteError)
          return NextResponse.json(
            { error: 'Failed to delete student assignment docs' },
            { status: 500 }
          )
        }
      }

      const { error: deleteError } = await supabase
        .from('classroom_enrollments')
        .delete()
        .eq('classroom_id', classroomId)
        .eq('student_id', studentId)

      if (deleteError) {
        console.error('Error removing student enrollment:', deleteError)
        return NextResponse.json(
          { error: 'Failed to remove student' },
          { status: 500 }
        )
      }
    }

    const { error: rosterDeleteError } = await supabase
      .from('classroom_roster')
      .delete()
      .eq('id', rosterId)
      .eq('classroom_id', classroomId)

    if (rosterDeleteError) {
      console.error('Error removing roster entry:', rosterDeleteError)
      return NextResponse.json(
        { error: 'Failed to remove roster entry' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (error.name === 'AuthorizationError') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    console.error('Remove student error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

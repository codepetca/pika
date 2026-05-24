import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { withErrorHandler } from '@/lib/api-handler'
import {
  getKnownRosterRemovalRpcError,
  removeClassroomRosterEntriesAtomic,
} from '@/lib/server/roster-removal'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// PATCH /api/teacher/classrooms/[id]/roster/[rosterId] - Update roster entry (e.g., counselor_email)
export const PATCH = withErrorHandler('PatchRosterEntry', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: classroomId, rosterId } = await context.params
  const body = await request.json()

  const supabase = getServiceRoleClient()

  const ownership = await assertTeacherCanMutateClassroom(user.id, classroomId)
  if (!ownership.ok) {
    return NextResponse.json(
      { error: ownership.error },
      { status: ownership.status }
    )
  }

  // Only allow updating counselor_email for now
  const { counselor_email } = body
  if (counselor_email !== undefined && counselor_email !== null && typeof counselor_email !== 'string') {
    return NextResponse.json(
      { error: 'counselor_email must be a string or null' },
      { status: 400 }
    )
  }

  const updateData: { counselor_email?: string | null } = {}
  if (counselor_email !== undefined) {
    updateData.counselor_email = counselor_email?.trim() || null
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      { error: 'No valid fields to update' },
      { status: 400 }
    )
  }

  const { data: updated, error: updateError } = await supabase
    .from('classroom_roster')
    .update(updateData)
    .eq('id', rosterId)
    .eq('classroom_id', classroomId)
    .select('id, counselor_email')
    .single()

  if (updateError) {
    console.error('Error updating roster entry:', updateError)
    return NextResponse.json(
      { error: 'Failed to update roster entry' },
      { status: 500 }
    )
  }

  if (!updated) {
    return NextResponse.json(
      { error: 'Roster entry not found' },
      { status: 404 }
    )
  }

  return NextResponse.json({ success: true, roster: updated })
})

// DELETE /api/teacher/classrooms/[id]/roster/[rosterId] - Remove roster entry (and enrollment if joined)
export const DELETE = withErrorHandler('DeleteRosterEntry', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id: classroomId, rosterId } = await context.params

  const supabase = getServiceRoleClient()

  const ownership = await assertTeacherCanMutateClassroom(user.id, classroomId)
  if (!ownership.ok) {
    return NextResponse.json(
      { error: ownership.error },
      { status: ownership.status }
    )
  }

  const { data, error } = await removeClassroomRosterEntriesAtomic({
    supabase,
    classroomId,
    rosterIds: [rosterId],
  })

  if (error) {
    const knownError = getKnownRosterRemovalRpcError(error)
    if (knownError) {
      const status = knownError.message === 'One or more roster entries not found in classroom'
        ? 404
        : knownError.status
      return NextResponse.json({ error: knownError.message }, { status })
    }

    console.error('Error removing roster entry:', error)
    return NextResponse.json({ error: 'Failed to remove roster entry' }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    requested_count: Number(data?.requested_count ?? 1),
    deleted_roster_entries: Number(data?.deleted_roster_entries ?? 0),
    deleted_entries: Number(data?.deleted_entries ?? 0),
    deleted_assignment_docs: Number(data?.deleted_assignment_docs ?? 0),
    deleted_enrollments: Number(data?.deleted_enrollments ?? 0),
  })
})

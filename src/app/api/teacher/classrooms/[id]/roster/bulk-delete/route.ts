import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  getKnownRosterRemovalRpcError,
  MAX_ROSTER_REMOVALS_PER_REQUEST,
  normalizeRosterIds,
  removeClassroomRosterEntriesAtomic,
} from '@/lib/server/roster-removal'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/classrooms/[id]/roster/bulk-delete - Atomically remove selected roster entries
export const POST = withErrorHandler('PostTeacherRosterBulkDelete', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: classroomId } = await context.params
  const body = await request.json()
  const rosterIds = normalizeRosterIds(body?.roster_ids)

  if (rosterIds.length === 0) {
    return NextResponse.json({ error: 'roster_ids array is required' }, { status: 400 })
  }

  if (rosterIds.length > MAX_ROSTER_REMOVALS_PER_REQUEST) {
    return NextResponse.json(
      { error: `Cannot remove more than ${MAX_ROSTER_REMOVALS_PER_REQUEST} roster entries at once` },
      { status: 400 }
    )
  }

  const ownership = await assertTeacherCanMutateClassroom(user.id, classroomId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }

  const supabase = getServiceRoleClient()
  const { data, error } = await removeClassroomRosterEntriesAtomic({
    supabase,
    classroomId,
    rosterIds,
  })

  if (error) {
    const knownError = getKnownRosterRemovalRpcError(error)
    if (knownError) {
      return NextResponse.json({ error: knownError.message }, { status: knownError.status })
    }

    console.error('Error bulk deleting roster entries:', error)
    return NextResponse.json({ error: 'Failed to remove students' }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    requested_count: Number(data?.requested_count ?? rosterIds.length),
    deleted_roster_entries: Number(data?.deleted_roster_entries ?? 0),
    deleted_entries: Number(data?.deleted_entries ?? 0),
    deleted_assignment_docs: Number(data?.deleted_assignment_docs ?? 0),
    deleted_enrollments: Number(data?.deleted_enrollments ?? 0),
  })
})

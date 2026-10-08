import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServiceRoleClient } from '@/lib/supabase'
import { withErrorHandler } from '@/lib/api-handler'
import {
  getFutureScheduledReleaseDueDateError,
} from '@/lib/assignment-schedule-validation'
import { authorizeContextualAssignmentOwnerMutationRequest } from '@/lib/server/contextual-assignment-owner-mutation-access'
import { releaseAssignmentForOwner } from '@/lib/server/contextual-assignment-owner-mutations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const assignmentReleaseRequestSchema = z.object({
  release_at: z.unknown().optional(),
}).passthrough()

// POST /api/teacher/assignments/[id]/release - Release a draft assignment to students
export const POST = withErrorHandler('PostTeacherAssignmentRelease', async (request, context) => {
  const resolveAssignmentId = async () => (await context.params).id
  const assignmentAccess = await authorizeContextualAssignmentOwnerMutationRequest(resolveAssignmentId)
  const id = assignmentAccess.assignmentId
  const user = assignmentAccess.user
  const body = assignmentReleaseRequestSchema.parse(await request.json().catch(() => ({})))
  const releaseAt = body?.release_at as string | undefined
  const supabase = getServiceRoleClient()

  // Fetch assignment and verify ownership
  const { data: existing, error: existingError } = await supabase
    .from('assignments')
    .select(`
      *,
      classrooms!inner (
        teacher_id,
        archived_at
      )
    `)
    .eq('id', id)
    .single()

  if (existingError || !existing) {
    return NextResponse.json(
      { error: 'Assignment not found' },
      { status: 404 }
    )
  }

  if (existing.classrooms.teacher_id !== user.id) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 403 }
    )
  }

  if (existing.classrooms.archived_at) {
    return NextResponse.json(
      { error: 'Classroom is archived' },
      { status: 403 }
    )
  }

  // Check if already released
  if (!existing.is_draft) {
    return NextResponse.json(
      { error: 'Assignment is already released' },
      { status: 400 }
    )
  }

  let releasedAtIso = new Date().toISOString()
  if (releaseAt !== undefined) {
    const parsed = new Date(releaseAt)
    if (isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: 'Invalid release date' },
        { status: 400 }
      )
    }
    if (parsed <= new Date()) {
      return NextResponse.json(
        { error: 'Release date must be in the future' },
        { status: 400 }
      )
    }
    const scheduleDueDateError = getFutureScheduledReleaseDueDateError({
      releaseAt: parsed,
      dueAt: existing.due_at,
    })
    if (scheduleDueDateError) {
      return NextResponse.json(
        { error: scheduleDueDateError },
        { status: 400 }
      )
    }
    releasedAtIso = parsed.toISOString()
  }

  let assignment
  if (assignmentAccess.mode === 'contextual') {
    const result = await releaseAssignmentForOwner({
      supabase,
      actorId: user.id,
      assignmentId: id,
      releasedAt: releasedAtIso,
      scheduled: releaseAt !== undefined,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    assignment = result.assignment
  } else {
    // Release the assignment
    const { data: updatedAssignment, error } = await supabase
      .from('assignments')
      .update({
        is_draft: false,
        released_at: releasedAtIso
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error releasing assignment:', error)
      return NextResponse.json(
        { error: 'Failed to release assignment' },
        { status: 500 }
      )
    }
    assignment = updatedAssignment
  }

  return NextResponse.json({ assignment })
})

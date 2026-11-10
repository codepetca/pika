import { NextResponse } from 'next/server'
import { throwBillingClassroomPublicationError } from '@/lib/server/billing/classroom-publication-errors'
import { resolveBillingAssignmentRelease, stageBillingAssignmentRelease } from '@/lib/server/billing/assignment-releases'
import { logServerError } from '@/lib/server/diagnostics'
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
  expected_intent_id: z.uuid().optional(),
}).passthrough()
const cancelAssignmentReleaseSchema = z.object({ expected_intent_id: z.uuid() }).strict()

// POST /api/teacher/assignments/[id]/release - Release a draft assignment to students
export const POST = withErrorHandler('PostTeacherAssignmentRelease', async (request, context) => {
  const resolveAssignmentId = async () => (await context.params).id
  const assignmentAccess = await authorizeContextualAssignmentOwnerMutationRequest(resolveAssignmentId)
  const id = assignmentAccess.assignmentId
  const user = assignmentAccess.user
  const body = assignmentReleaseRequestSchema.parse(request.body === null ? {} : await request.json().catch(() => null))
  const releaseAt = body?.release_at as string | undefined
  const expectedIntentId = body.expected_intent_id
  const supabase = getServiceRoleClient()

  if (expectedIntentId) {
    if (releaseAt === undefined) {
      const assignment = await resolveBillingAssignmentRelease(supabase, user.id, id, expectedIntentId, 'publish')
      return NextResponse.json({ assignment })
    }
    const parsed = new Date(releaseAt)
    if (typeof releaseAt !== 'string' || !Number.isFinite(parsed.getTime())) {
      return NextResponse.json({ error: 'Invalid release date' }, { status: 400 })
    }
    const assignment = await stageBillingAssignmentRelease(supabase, user.id, id, parsed.toISOString(), expectedIntentId)
    return NextResponse.json({ assignment })
  }

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
    // Retired Blueprint drafts retain legacy scheduling under the database's
    // publication and release-intent guards. The staging RPC uses the stricter
    // contextual owner lock and rejects these drafts before checking billing.
    if (assignmentAccess.mode !== 'legacy' || !existing.blueprint_archived_at) {
      const scheduledAssignment = await stageBillingAssignmentRelease(supabase, user.id, existing.id, releasedAtIso)
      if (scheduledAssignment) return NextResponse.json({ assignment: scheduledAssignment })
    }
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
      throwBillingClassroomPublicationError(error)
      logServerError('assignment.release', error)
      return NextResponse.json(
        { error: 'Failed to release assignment' },
        { status: 500 }
      )
    }
    assignment = updatedAssignment
  }

  return NextResponse.json({ assignment })
})

// DELETE /api/teacher/assignments/[id]/release - Cancel the observed release schedule.
export const DELETE = withErrorHandler('DeleteTeacherAssignmentRelease', async (request, context) => {
  const access = await authorizeContextualAssignmentOwnerMutationRequest(async () => (await context.params).id)
  const { expected_intent_id: expectedIntentId } = cancelAssignmentReleaseSchema.parse(await request.json().catch(() => null))
  const assignment = await resolveBillingAssignmentRelease(
    getServiceRoleClient(), access.user.id, access.assignmentId, expectedIntentId, 'cancel',
  )
  return NextResponse.json({ assignment })
})

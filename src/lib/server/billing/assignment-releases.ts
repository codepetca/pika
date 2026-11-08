import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import type { getServiceRoleClient } from '@/lib/supabase'
import { isRetryableDatabaseContention } from '@/lib/server/database-contention'
import { logServerError } from '@/lib/server/diagnostics'
import { assignmentReleaseScheduleSchema } from './assignment-release-state'
import { throwBillingClassroomPublicationError } from './classroom-publication-errors'

type AssignmentReleaseClient = Pick<ReturnType<typeof getServiceRoleClient>, 'rpc'>

const releaseMutationSchema = z.object({
  assignment: z.object({
    id: z.uuid(),
    is_draft: z.boolean(),
    released_at: z.iso.datetime({ offset: true }).nullable(),
  }).passthrough(),
  release_schedule: assignmentReleaseScheduleSchema.nullable(),
}).strict()
const releaseOutcomeSchema = z.enum(['released', 'suppressed', 'superseded', 'noop', 'busy', 'disabled'])

function throwScheduleMutationError(error: { code?: string; message?: string }): never {
  throwBillingClassroomPublicationError(error)
  if (error.code === 'P0002') throw new ApiError(404, 'Assignment not found')
  if (error.code === '42501') throw new ApiError(403, 'Unauthorized')
  if (error.code === '55000') throw new ApiError(403, 'Classroom is archived')
  if (error.code === 'PT400') throw new ApiError(400, 'Invalid assignment release date')
  if (error.code === 'PT409' || isRetryableDatabaseContention(error)) {
    throw new ApiError(409, 'Assignment changed during this update. Refresh and try again.')
  }
  throw new ApiError(503, 'Unable to update assignment release')
}

export async function stageBillingAssignmentRelease(
  client: AssignmentReleaseClient,
  actorId: string,
  assignmentId: string,
  scheduledFor: string,
  expectedIntentId?: string,
) {
  const { data, error } = await client.rpc('schedule_assignment_for_billing_v1', {
    p_actor_id: actorId, p_assignment_id: assignmentId, p_scheduled_for: scheduledFor,
    ...(expectedIntentId ? { p_expected_intent_id: expectedIntentId } : {}),
  })
  if (error) {
    if (error.code === 'PGRST202' && !expectedIntentId) return null
    throwScheduleMutationError(error)
  }
  if (data === null && !expectedIntentId) return null
  const parsed = releaseMutationSchema.safeParse(data)
  if (!parsed.success || parsed.data.assignment.id !== assignmentId
    || !parsed.data.assignment.is_draft || parsed.data.assignment.released_at !== null
    || parsed.data.release_schedule?.state !== 'pending'
    || Date.parse(parsed.data.release_schedule.scheduled_for) !== Date.parse(scheduledFor)) {
    throw new ApiError(503, 'Unable to verify scheduled assignment')
  }
  return { ...parsed.data.assignment, release_schedule: parsed.data.release_schedule }
}

export async function resolveBillingAssignmentRelease(
  client: AssignmentReleaseClient,
  actorId: string,
  assignmentId: string,
  expectedIntentId: string,
  action: 'cancel' | 'publish',
) {
  const { data, error } = await client.rpc(
    action === 'cancel' ? 'cancel_assignment_release_for_owner_v1' : 'publish_scheduled_assignment_for_owner_v1',
    { p_actor_id: actorId, p_assignment_id: assignmentId, p_expected_intent_id: expectedIntentId },
  )
  if (error) throwScheduleMutationError(error)
  const parsed = releaseMutationSchema.safeParse(data)
  const canceled = action === 'cancel'
  if (!parsed.success || parsed.data.assignment.id !== assignmentId || parsed.data.release_schedule !== null
    || parsed.data.assignment.is_draft !== canceled || (parsed.data.assignment.released_at === null) !== canceled) {
    throw new ApiError(503, 'Unable to verify assignment release update')
  }
  return { ...parsed.data.assignment, release_schedule: null }
}

export async function processDueBillingAssignmentReleases(client: AssignmentReleaseClient) {
  const { data, error } = await client.rpc('list_due_billing_assignment_releases_v1', { p_limit: 8 })
  if (error?.code === 'PGRST202') return undefined
  if (error) throw new Error('Unable to list due assignment releases')
  const ids = z.array(z.uuid()).max(8).parse(data)
  const outcomes: Partial<Record<z.infer<typeof releaseOutcomeSchema> | 'failed', number>> = {}
  for (const id of ids) {
    const { data: outcome, error: processError } = await client.rpc('process_billing_assignment_release_v1', { p_intent_id: id })
    const parsed = releaseOutcomeSchema.safeParse(outcome)
    if (processError) logServerError('api.unexpected', processError)
    else if (!parsed.success) logServerError('api.unexpected', new Error('Unable to verify scheduled assignment outcome'))
    const state = !processError && parsed.success ? parsed.data : 'failed'
    outcomes[state] = (outcomes[state] ?? 0) + 1
  }
  return outcomes
}

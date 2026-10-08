import { ApiError } from '@/lib/api-error'
import { getServiceRoleClient } from '@/lib/supabase'
import { contextualRosterRemovalActorSchema, contextualRosterRemovalBodySchema,
  contextualRosterRemovalEnvelopeSchema, contextualRosterRemovalParamsSchema } from '@/lib/validations/contextual-roster-removal'

const unavailable = () => new ApiError(503, 'Unable to verify class removal. Refresh the roster before trying again.')
const duplicateSelectionMessage = 'This student has multiple roster rows. Resolve the duplicate roster entries before removing them.'

function mapError(error: { code: string; message?: string | null }): never {
  if (error.code === '42501') throw new ApiError(403, 'You cannot remove students from this class.')
  if (error.code === '22023') throw new ApiError(400, 'Invalid roster removal request')
  if (error.code === 'PT409' && error.message === duplicateSelectionMessage) throw new ApiError(409, duplicateSelectionMessage)
  if (['PT409', '40001', '40P01', '55P03', '55000'].includes(error.code)) {
    throw new ApiError(409, 'The roster changed or this class is busy. Refresh it and try again.')
  }
  throw unavailable()
}

export async function removeContextualRosterStudents(input: { actorId: string; classroomId: string; rosterIds: string[] }) {
  const actor = contextualRosterRemovalActorSchema.safeParse(input.actorId)
  if (!actor.success) throw unavailable()
  const { id: classroomId } = contextualRosterRemovalParamsSchema.parse({ id: input.classroomId })
  const { roster_ids: rosterIds } = contextualRosterRemovalBodySchema.parse({ roster_ids: input.rosterIds })
  let response: unknown
  try {
    response = await getServiceRoleClient().rpc('remove_classroom_students_for_owner_v1', {
      p_actor_id: actor.data, p_classroom_id: classroomId, p_roster_ids: rosterIds,
    })
  } catch {
    // A failed response may follow a committed transaction. Refresh before retrying.
    throw unavailable()
  }
  const envelope = contextualRosterRemovalEnvelopeSchema.safeParse(response)
  if (!envelope.success) throw unavailable()
  if (envelope.data.error !== null) mapError(envelope.data.error)
  const { data, count, status } = envelope.data
  if ((status !== undefined && (status < 200 || status >= 300)) || (count !== undefined && count !== null && count !== 1)
    || data.actor_id !== actor.data || data.classroom_id !== classroomId
    || data.requested_count !== rosterIds.length || data.removed_count > data.requested_count
    || data.roster_ids.length !== rosterIds.length || data.roster_ids.some((id, index) => id !== rosterIds[index])) throw unavailable()
  return { success: true as const, requested_count: data.requested_count, removed_count: data.removed_count }
}

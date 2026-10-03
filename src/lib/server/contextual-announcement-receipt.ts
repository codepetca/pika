import { ApiError } from '@/lib/api-error'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  announcementReceiptActorSchema,
  announcementReceiptEnvelopeSchema,
  announcementReceiptParamsSchema,
} from '@/lib/validations/contextual-announcement-receipt'

const unavailable = () => new ApiError(503, 'Unable to verify announcement read receipts')
function mapRpcError(error: { code: string }): never {
  if (error.code === '42501') throw new ApiError(403, 'Forbidden')
  if (error.code === 'P0002') throw new ApiError(404, 'Classroom not found')
  if (error.code === '22023') throw new ApiError(400, 'Invalid announcement receipt request')
  if (error.code === 'PT409') throw new ApiError(409, 'Announcements changed. Refresh and try again.')
  throw unavailable()
}

/** Current active non-owner membership and eligible announcements are decided atomically in SQL. */
export async function markContextualAnnouncementsRead(input: {
  actorId: string; classroomId: string
}) {
  const actor = announcementReceiptActorSchema.safeParse(input.actorId)
  if (!actor.success) throw unavailable()
  const { id: classroomId } = announcementReceiptParamsSchema.parse({ id: input.classroomId })
  let response: unknown
  try {
    const supabase = getServiceRoleClient()
    const cutoff = new Date().toISOString()
    response = await supabase.rpc('mark_announcements_read_for_member_v1', {
      p_actor_id: actor.data, p_classroom_id: classroomId, p_cutoff: cutoff,
    })
  } catch { throw unavailable() }
  const envelope = announcementReceiptEnvelopeSchema.safeParse(response)
  if (!envelope.success) throw unavailable()
  if (envelope.data.error !== null) mapRpcError(envelope.data.error)
  const result = envelope.data.data
  if (result.actor_id !== actor.data || result.classroom_id !== classroomId) throw unavailable()
  return { success: true as const, marked: result.marked }
}

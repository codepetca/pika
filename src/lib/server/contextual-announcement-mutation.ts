import { ApiError } from '@/lib/api-error'
import { getServiceRoleClient } from '@/lib/supabase'
import { isRetryableDatabaseContention } from '@/lib/server/database-contention'
import {
  announcementCreateParamsSchema,
  announcementMutationParamsSchema,
  announcementMutationActorSchema,
  announcementMutationEnvelopeSchema,
  announcementDeleteEnvelopeSchema,
  type AnnouncementCreateInput,
  type AnnouncementUpdateInput,
} from '@/lib/validations/announcement-mutations'
import { compareAnnouncementReadTimestamps } from '@/lib/validations/announcement-reads'

const unavailable = () => new ApiError(503, 'Unable to verify announcement mutation')
function mapRpcError(error: { code: string }): never {
  if (error.code === '42501') throw new ApiError(403, 'Forbidden')
  if (error.code === 'P0002') throw new ApiError(404, 'Classroom not found')
  if (error.code === 'PT404') throw new ApiError(404, 'Announcement not found')
  if (error.code === '22023') throw new ApiError(400, 'Invalid announcement mutation request')
  if (error.code === 'PT409' || isRetryableDatabaseContention(error)) {
    throw new ApiError(409, 'Announcement changed during this update. Refresh and try again.')
  }
  throw unavailable()
}
function actorId(value: string): string {
  const actor = announcementMutationActorSchema.safeParse(value)
  if (!actor.success) throw unavailable()
  return actor.data
}
async function invoke(operation: () => PromiseLike<unknown>): Promise<unknown> {
  try { return await operation() } catch { throw unavailable() }
}
function announcementResult(response: unknown, classroomId: string, body: AnnouncementUpdateInput) {
  const envelope = announcementMutationEnvelopeSchema.safeParse(response)
  if (!envelope.success) throw unavailable()
  if (envelope.data.error !== null) mapRpcError(envelope.data.error)
  const { announcement } = envelope.data.data
  if (announcement.classroom_id !== classroomId
    || (body.content !== undefined && announcement.content !== body.content)
    || (body.title !== undefined && announcement.title !== body.title)
    || (body.is_draft === true && !announcement.is_draft)
    || (body.is_draft === false && announcement.is_draft)
    || (body.is_draft !== true && body.scheduled_for !== undefined && (
      announcement.is_draft || (body.scheduled_for === null
        ? announcement.scheduled_for !== null
        : announcement.scheduled_for === null
          || compareAnnouncementReadTimestamps(body.scheduled_for, announcement.scheduled_for) !== 0)
    ))) throw unavailable()
  return { announcement }
}

/** Ownership, archive state and publication changes are decided by the locked database operation. */
export async function createContextualAnnouncement(input: {
  actorId: string; classroomId: string; body: AnnouncementCreateInput
}) {
  const actor = actorId(input.actorId)
  const { id: classroomId } = announcementCreateParamsSchema.parse({ id: input.classroomId })
  const response = await invoke(() => getServiceRoleClient().rpc('create_announcement_for_owner_v1', {
    p_actor_id: actor,
    p_classroom_id: classroomId,
    p_content: input.body.content,
    p_is_draft: input.body.is_draft,
    p_scheduled_for: input.body.scheduled_for ?? null,
    p_title: input.body.title ?? null,
  }))
  const result = announcementResult(response, classroomId, input.body)
  if (result.announcement.created_by !== actor
    || result.announcement.title !== (input.body.title ?? null)
    || (!input.body.is_draft && input.body.scheduled_for == null && result.announcement.scheduled_for !== null)) throw unavailable()
  return result
}

export async function updateContextualAnnouncement(input: {
  actorId: string; classroomId: string; announcementId: string; body: AnnouncementUpdateInput
}) {
  const actor = actorId(input.actorId)
  const params = announcementMutationParamsSchema.parse({ id: input.classroomId, announcementId: input.announcementId })
  const patch = Object.fromEntries(Object.entries(input.body).filter(([, value]) => value !== undefined))
  const response = await invoke(() => getServiceRoleClient().rpc('update_announcement_for_owner_v1', {
    p_actor_id: actor,
    p_classroom_id: params.id,
    p_announcement_id: params.announcementId,
    p_patch: patch,
  }))
  const result = announcementResult(response, params.id, input.body)
  if (result.announcement.id !== params.announcementId) throw unavailable()
  // A transferred classroom retains the historical announcement author.
  return result
}

export async function deleteContextualAnnouncement(input: {
  actorId: string; classroomId: string; announcementId: string
}) {
  const actor = actorId(input.actorId)
  const params = announcementMutationParamsSchema.parse({ id: input.classroomId, announcementId: input.announcementId })
  const response = await invoke(() => getServiceRoleClient().rpc('delete_announcement_for_owner_v1', {
    p_actor_id: actor, p_classroom_id: params.id, p_announcement_id: params.announcementId,
  }))
  const envelope = announcementDeleteEnvelopeSchema.safeParse(response)
  if (!envelope.success) throw unavailable()
  if (envelope.data.error !== null) mapRpcError(envelope.data.error)
  if (envelope.data.data.classroom_id !== params.id || envelope.data.data.announcement_id !== params.announcementId) throw unavailable()
  return { success: true as const }
}

import { ApiError } from '@/lib/api-error'
import type { getServiceRoleClient } from '@/lib/supabase'
import { hydrateClassroomRecord } from '@/lib/server/classrooms'
import { mapClassroomCreationDatabaseError, type ClassroomCreationDenial } from '@/lib/server/classroom-creation-entitlement'
import { contextualClassroomDetailOwnerEnvelopeSchema } from '@/lib/validations/contextual-classroom-detail'
import {
  contextualClassroomHotLifecycleIdentitySchema, contextualClassroomHotLifecycleErrorEnvelopeSchema,
} from '@/lib/validations/contextual-classroom-hot-lifecycle'

const unavailable = () => new ApiError(503, 'Unable to verify classroom lifecycle update; refresh to reconcile its outcome')

type HotLifecycleOutcome =
  | { kind: 'updated'; classroom: ReturnType<typeof hydrateClassroomRecord> }
  | { kind: 'denied'; denial: ClassroomCreationDenial }

/** SQL owns authorization, restore capacity and atomic postconditions, including trigger effects. */
export async function setContextualClassroomHotArchive(input: {
  supabase: ReturnType<typeof getServiceRoleClient>; actorId: string; classroomId: string; archived: boolean
}): Promise<HotLifecycleOutcome> {
  const { actorId, classroomId, archived } = contextualClassroomHotLifecycleIdentitySchema.parse({
    actorId: input.actorId, classroomId: input.classroomId, archived: input.archived,
  })
  let result: unknown
  try {
    result = await input.supabase.rpc('set_classroom_hot_archive_for_owner_v1', {
      p_actor_id: actorId, p_classroom_id: classroomId, p_archived: archived,
    })
  } catch { throw unavailable() }
  const failure = contextualClassroomHotLifecycleErrorEnvelopeSchema.safeParse(result)
  if (failure.success) {
    const { code, message } = failure.data.error
    const denial = mapClassroomCreationDatabaseError(failure.data.error)
    if (denial) return { kind: 'denied', denial }
    if (code === 'PT400' && message === 'classroom_hot_lifecycle_invalid_patch') throw new ApiError(400, 'Invalid classroom lifecycle update')
    if (code === 'PT400' && message === 'classroom_hot_lifecycle_already_archived') throw new ApiError(400, 'Classroom is already archived')
    if (code === 'PT400' && message === 'classroom_hot_lifecycle_not_archived') throw new ApiError(400, 'Classroom is not archived')
    if (code === 'PT403' && message === 'classroom_hot_lifecycle_forbidden') throw new ApiError(403, 'Forbidden')
    if (code === 'PT403' && message === 'classroom_hot_lifecycle_fenced') throw new ApiError(403, 'Classroom updates are unavailable during this lifecycle operation')
    if (code === 'PT404' && message === 'classroom_hot_lifecycle_not_found') throw new ApiError(404, 'Classroom not found')
    if (code === 'PT409' && message === 'classroom_hot_lifecycle_busy') throw new ApiError(409, 'Classroom changed during this update. Refresh and try again.')
    throw unavailable()
  }
  let envelope: ReturnType<typeof contextualClassroomDetailOwnerEnvelopeSchema.safeParse>
  try { envelope = contextualClassroomDetailOwnerEnvelopeSchema.safeParse(result) } catch { throw unavailable() }
  if (!envelope.success || envelope.data.data === null) throw unavailable()
  const row = envelope.data.data
  if (row.id !== classroomId || row.teacher_id !== actorId || (row.archived_at !== null) !== archived) throw unavailable()
  return { kind: 'updated', classroom: hydrateClassroomRecord(row) }
}

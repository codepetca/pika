import { isDeepStrictEqual } from 'node:util'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import type { getServiceRoleClient } from '@/lib/supabase'
import { hydrateClassroomRecord } from '@/lib/server/classrooms'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { contextualClassroomDetailOwnerEnvelopeSchema } from '@/lib/validations/contextual-classroom-detail'
import {
  contextualClassroomMetadataIdentitySchema, contextualClassroomMetadataErrorEnvelopeSchema,
  normalizeContextualClassroomMetadataPatch, type ContextualClassroomMetadataPatch,
} from '@/lib/validations/contextual-classroom-metadata'
import type { AuthenticatedUser } from '@/types'

const unavailable = () => new ApiError(503, 'Unable to verify classroom metadata update; refresh to reconcile its outcome')
export async function authorizeSharedClassroomMetadataActor(): Promise<{ mode: 'existing' } | { mode: 'shared'; user: AuthenticatedUser }> {
  if (!isClassroomExperienceAdmissionConfigured()) return { mode: 'existing' }
  const user = await requireAuth()
  if (resolveClassroomExperienceAdmission(user).status !== 'admitted') return { mode: 'existing' }
  return { mode: 'shared', user }
}

/** SQL owns transaction-time postconditions; lost or malformed transport cannot certify rollback. */
export async function updateContextualClassroomMetadata(input: {
  supabase: ReturnType<typeof getServiceRoleClient>; actorId: string; classroomId: string; patch: ContextualClassroomMetadataPatch
}) {
  const { actorId, classroomId } = contextualClassroomMetadataIdentitySchema.parse({ actorId: input.actorId, classroomId: input.classroomId })
  const patch = normalizeContextualClassroomMetadataPatch(input.patch)
  let result: unknown
  try {
    result = await input.supabase.rpc('update_classroom_metadata_for_owner_v1', { p_actor_id: actorId, p_classroom_id: classroomId, p_patch: patch })
  } catch { throw unavailable() }
  const failure = contextualClassroomMetadataErrorEnvelopeSchema.safeParse(result)
  if (failure.success) {
    const { code, message } = failure.data.error
    if (code === 'PT400' && message === 'classroom_metadata_invalid_patch') throw new ApiError(400, 'Invalid classroom metadata')
    if (code === 'PT400' && message === 'classroom_metadata_public_slug_required') throw new ApiError(400, 'A public page address is required before sharing the course guide publicly')
    if (code === 'PT403' && message === 'classroom_metadata_forbidden') throw new ApiError(403, 'Forbidden')
    if (code === 'PT403' && message === 'classroom_metadata_archived') throw new ApiError(403, 'Classroom is archived')
    if (code === 'PT403' && message === 'classroom_metadata_fenced') throw new ApiError(403, 'Classroom updates are unavailable during this lifecycle operation')
    if (code === 'PT404' && message === 'classroom_metadata_not_found') throw new ApiError(404, 'Classroom not found')
    if (code === 'PT409' && message === 'classroom_metadata_slug_conflict') throw new ApiError(409, 'That course guide address is already in use')
    if (code === 'PT409' && message === 'classroom_metadata_busy') throw new ApiError(409, 'Classroom changed during this update. Refresh and try again.')
    throw unavailable()
  }
  // The shared full-row schema includes historical recursive JSON; malformed depth still fails as 503.
  let envelope: ReturnType<typeof contextualClassroomDetailOwnerEnvelopeSchema.safeParse>
  try { envelope = contextualClassroomDetailOwnerEnvelopeSchema.safeParse(result) } catch { throw unavailable() }
  if (!envelope.success || envelope.data.data === null) throw unavailable()
  const row = envelope.data.data
  if (row.id !== classroomId || row.teacher_id !== actorId || row.archived_at !== null
    || (row.actual_site_published && !row.actual_site_slug)) throw unavailable()
  for (const [key, value] of Object.entries(patch)) {
    const actual = Object.entries(row).find(([column]) => column === key)?.[1]
    if (!isDeepStrictEqual(actual, value)) throw unavailable()
  }
  return hydrateClassroomRecord(row)
}

import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { isRetryableDatabaseContention } from '@/lib/server/database-contention'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { contextualMaterialCreateSchema } from '@/lib/validations/classwork-authoring'
import {
  materialMutationActorSchema, materialCreateParamsSchema, materialMutationParamsSchema,
  materialMutationEnvelopeSchema, materialDeleteEnvelopeSchema, type MaterialUpdateInput,
} from '@/lib/validations/material-mutations'
import type { AuthenticatedUser } from '@/types'
import type { Json } from '@/types/database.generated'

const unavailable = () => new ApiError(503, 'Unable to verify material mutation')
export async function authorizeSharedMaterialMutationActor(): Promise<{ mode: 'existing' } | { mode: 'shared'; user: AuthenticatedUser }> {
  if (!isClassroomExperienceAdmissionConfigured()) return { mode: 'existing' }
  const user = await requireAuth()
  if (resolveClassroomExperienceAdmission(user).status !== 'admitted') return { mode: 'existing' }
  return { mode: 'shared', user }
}
function actorId(value: string): string {
  const parsed = materialMutationActorSchema.safeParse(value)
  if (!parsed.success) throw unavailable()
  return parsed.data
}
function mapRpcError(error: { code: string }): never {
  if (error.code === '42501') throw new ApiError(403, 'Forbidden')
  if (error.code === 'P0002') throw new ApiError(404, 'Classroom not found')
  if (error.code === 'PT404') throw new ApiError(404, 'Material not found')
  if (error.code === '22023') throw new ApiError(400, 'Invalid material mutation request')
  if (error.code === 'PT409' || isRetryableDatabaseContention(error)) {
    throw new ApiError(409, 'Material changed during this update. Refresh and try again.')
  }
  throw unavailable()
}
async function invoke(operation: () => PromiseLike<unknown>): Promise<unknown> {
  try { return await operation() } catch { throw unavailable() }
}
function sameJson(left: unknown, right: unknown): boolean {
  // Compare the JSON transport value: JSON serializes -0 as 0 and omits
  // undefined object properties before PostgREST stores canonical jsonb.
  try { return isDeepStrictEqual(left, JSON.parse(JSON.stringify(right))) } catch { return false }
}
function materialResult(response: unknown, actor: string, classroomId: string, body: MaterialUpdateInput) {
  const envelope = materialMutationEnvelopeSchema.safeParse(response)
  if (!envelope.success) throw unavailable()
  if (envelope.data.error !== null) mapRpcError(envelope.data.error)
  const { material, actor_id, classroom_id } = envelope.data.data
  if (actor_id !== actor || classroom_id !== classroomId || material.classroom_id !== classroomId
    || (body.title !== undefined && material.title !== body.title)
    || (body.content !== undefined && !sameJson(material.content, body.content))
    || (body.is_draft !== undefined && material.is_draft !== body.is_draft)
    || (body.is_draft === true && material.released_at !== null)
    || (body.is_draft === false && material.released_at === null)) throw unavailable()
  return { material }
}

/** The locked database row controls publication, ownership, and retained historical lineage. */
export async function createContextualMaterial(input: {
  actorId: string; classroomId: string; body: z.infer<typeof contextualMaterialCreateSchema>
}) {
  const actor = actorId(input.actorId)
  const { id: classroomId } = materialCreateParamsSchema.parse({ id: input.classroomId })
  const response = await invoke(() => getServiceRoleClient().rpc('create_classwork_material_for_owner_v2', {
    p_actor_id: actor, p_classroom_id: classroomId,
    p_title: input.body.title, p_content: input.body.content as unknown as Json, p_is_draft: input.body.is_draft,
  }))
  const result = materialResult(response, actor, classroomId, input.body)
  if (result.material.created_by !== actor
    || result.material.source_artifact_id !== null || result.material.source_blueprint_version_id !== null
    || result.material.blueprint_archived_at !== null) throw unavailable()
  return result
}
export async function updateContextualMaterial(input: {
  actorId: string; classroomId: string; materialId: string; body: MaterialUpdateInput
}) {
  const actor = actorId(input.actorId)
  const params = materialMutationParamsSchema.parse({ id: input.classroomId, materialId: input.materialId })
  const patch = Object.fromEntries(Object.entries(input.body).filter(([, value]) => value !== undefined))
  const response = await invoke(() => getServiceRoleClient().rpc('update_classwork_material_for_owner_v1', {
    p_actor_id: actor, p_classroom_id: params.id, p_material_id: params.materialId, p_patch: patch as unknown as Json,
  }))
  const result = materialResult(response, actor, params.id, input.body)
  if (result.material.id !== params.materialId) throw unavailable()
  return result
}
export async function deleteContextualMaterial(input: {
  actorId: string; classroomId: string; materialId: string
}) {
  const actor = actorId(input.actorId)
  const params = materialMutationParamsSchema.parse({ id: input.classroomId, materialId: input.materialId })
  const response = await invoke(() => getServiceRoleClient().rpc('delete_classwork_material_for_owner_v1', {
    p_actor_id: actor, p_classroom_id: params.id, p_material_id: params.materialId,
  }))
  const envelope = materialDeleteEnvelopeSchema.safeParse(response)
  if (!envelope.success) throw unavailable()
  if (envelope.data.error !== null) mapRpcError(envelope.data.error)
  const data = envelope.data.data
  if (data.actor_id !== actor || data.classroom_id !== params.id || data.material_id !== params.materialId) throw unavailable()
  return { success: true as const }
}

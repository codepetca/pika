import { ApiError } from '@/lib/api-error'
import { normalizeCourseBlueprintAuthoringGuidance } from '@/lib/course-blueprint-authoring-guidance'
import type { ClassroomAuthoringGuidance } from '@/lib/server/classroom-authoring-guidance'
import type { getServiceRoleClient } from '@/lib/supabase'
import {
  CLASSROOM_AUTHORING_GUIDANCE_WIRE_BYTES,
  contextualClassroomAuthoringGuidanceFailureSchema,
  contextualClassroomAuthoringGuidanceQuerySchema,
  contextualClassroomAuthoringGuidanceSuccessSchema,
} from '@/lib/validations/contextual-classroom-authoring-guidance-read'

const unavailable = () => new ApiError(503, 'Unable to verify classroom authoring guidance')

/** One statement snapshot of current classroom ownership and its selected saved
 * Versions. This is not live-Draft or current Blueprint-owner authorization. */
export async function readContextualClassroomAuthoringGuidance(input: {
  supabase: ReturnType<typeof getServiceRoleClient>
  actorId: string
  classroomId: string
}): Promise<{ context: ClassroomAuthoringGuidance | null }> {
  const identity = contextualClassroomAuthoringGuidanceQuerySchema.safeParse({ actorId: input.actorId, classroomId: input.classroomId })
  if (!identity.success) throw new ApiError(400, 'Invalid classroom authoring guidance query')
  const { actorId, classroomId } = identity.data
  let response: unknown
  try {
    response = await input.supabase.rpc('read_classroom_authoring_guidance_for_owner_v1', {
      p_actor_id: actorId, p_classroom_id: classroomId,
    }).abortSignal(AbortSignal.timeout(10_000))
    if (Buffer.byteLength(JSON.stringify(response), 'utf8') > CLASSROOM_AUTHORING_GUIDANCE_WIRE_BYTES) throw unavailable()
  } catch { throw unavailable() }
  const failure = contextualClassroomAuthoringGuidanceFailureSchema.safeParse(response)
  if (failure.success) {
    const { code, message } = failure.data.error
    if (failure.data.status === 400 && code === 'PT400' && message === 'class_authoring_guidance_invalid_argument') {
      throw new ApiError(400, 'Invalid classroom authoring guidance query')
    }
    if (failure.data.status === 404 && code === 'PT404' && message === 'class_authoring_guidance_missing') {
      throw new ApiError(404, 'Classroom not found')
    }
    if (failure.data.status === 403 && code === 'PT403' && message === 'class_authoring_guidance_forbidden') throw new ApiError(403, 'Forbidden')
    throw unavailable()
  }
  const success = contextualClassroomAuthoringGuidanceSuccessSchema.safeParse(response)
  if (!success.success) throw unavailable()
  const row = success.data.data
  if (row.actor_id !== actorId || row.classroom_id !== classroomId || row.classroom.id !== classroomId || row.classroom.teacher_id !== actorId) throw unavailable()
  const { classroom, context, version_parents: parents } = row
  if (classroom.source_blueprint_id === null || classroom.source_blueprint_version_id === null) {
    if (context !== null || parents !== null) throw unavailable()
    return { context: null }
  }
  if (!context || !parents || context.blueprint_id !== classroom.source_blueprint_id
    || context.content_version_id !== classroom.source_blueprint_version_id
    || context.source_blueprint_version_id !== (classroom.authoring_guidance_version_id ?? classroom.source_blueprint_version_id)
    || parents.content !== context.blueprint_id || parents.guidance !== context.blueprint_id) throw unavailable()
  const result = { context: { ...context, guidance: context.guidance ?? normalizeCourseBlueprintAuthoringGuidance(null) } }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > CLASSROOM_AUTHORING_GUIDANCE_WIRE_BYTES) throw unavailable()
  // Private classroom/Version-parent evidence never escapes the browser DTO.
  return result
}

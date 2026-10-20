import { ApiError } from '@/lib/api-error'
import { normalizeCourseBlueprintAuthoringGuidance } from '@/lib/course-blueprint-authoring-guidance'
import type { getServiceRoleClient } from '@/lib/supabase'
import { CLASSROOM_GUIDANCE_PREVIEW_WIRE_BYTES,
  contextualClassroomGuidancePreviewQuerySchema, contextualClassroomGuidancePreviewSuccessSchema,
  contextualClassroomGuidancePreviewFailureSchema } from '@/lib/validations/contextual-classroom-guidance-preview'

const unavailable = () => new ApiError(503, 'Unable to verify classroom guidance preview')

/** Unlike frozen classroom guidance, a live Draft preview requires both current
 * owners and an active classroom. No Version save or adoption occurs here. */
export async function readContextualClassroomGuidancePreview(input: {
  supabase: ReturnType<typeof getServiceRoleClient>; actorId: string; classroomId: string
}) {
  const identity = contextualClassroomGuidancePreviewQuerySchema.safeParse({ actorId: input.actorId, classroomId: input.classroomId })
  if (!identity.success) throw new ApiError(400, 'Invalid classroom guidance preview query')
  const { actorId, classroomId } = identity.data
  let response: unknown
  try {
    response = await input.supabase.rpc('preview_classroom_authoring_guidance_for_owner_v1', {
      p_actor_id: actorId, p_classroom_id: classroomId,
    }).abortSignal(AbortSignal.timeout(10_000))
    if (Buffer.byteLength(JSON.stringify(response), 'utf8') > CLASSROOM_GUIDANCE_PREVIEW_WIRE_BYTES) throw unavailable()
  } catch { throw unavailable() }
  const failure = contextualClassroomGuidancePreviewFailureSchema.safeParse(response)
  if (failure.success) {
    const { status, error: { code, message } } = failure.data
    if (status === 400 && code === 'PT400' && message === 'class_guidance_preview_invalid_argument') throw new ApiError(400, 'Invalid classroom guidance preview query')
    if (status === 404 && code === 'PT404' && message === 'class_guidance_preview_classroom_missing') throw new ApiError(404, 'Classroom not found')
    if (status === 404 && code === 'PT404' && message === 'class_guidance_preview_blueprint_missing') throw new ApiError(404, 'Course blueprint not found')
    if (status === 403 && code === 'PT403' && message === 'class_guidance_preview_forbidden') throw new ApiError(403, 'Forbidden')
    if (status === 403 && code === 'PT403' && message === 'class_guidance_preview_archived') throw new ApiError(403, 'Classroom is archived')
    if (status === 409 && code === 'PT409' && message === 'class_guidance_preview_unlinked') throw new ApiError(409, 'No Blueprint Version linked')
    throw unavailable()
  }
  const success = contextualClassroomGuidancePreviewSuccessSchema.safeParse(response)
  if (!success.success) throw unavailable()
  const row = success.data.data, { classroom, blueprint, versions } = row
  if (row.actor_id !== actorId || row.classroom_id !== classroomId || classroom.id !== classroomId || classroom.teacher_id !== actorId
    || blueprint.teacher_id !== actorId || blueprint.id !== classroom.source_blueprint_id
    || versions.content.id !== classroom.source_blueprint_version_id || versions.content.course_blueprint_id !== blueprint.id
    || versions.guidance.id !== (classroom.authoring_guidance_version_id ?? classroom.source_blueprint_version_id)
    || versions.guidance.course_blueprint_id !== blueprint.id) throw unavailable()
  // Domain decoding already normalizes present guidance exactly once. Historical
  // null rules use the same canonical empty value, not a second equality policy.
  const currentGuidance = row.current_guidance ?? normalizeCourseBlueprintAuthoringGuidance(null)
  const guidance = row.guidance ?? normalizeCourseBlueprintAuthoringGuidance(null)
  const result = { preview: { blueprint_id: blueprint.id, expected_content_version_id: versions.content.id,
    expected_guidance_version_id: versions.guidance.id, expected_draft_revision: blueprint.content_revision,
    current_guidance_version_number: versions.guidance.version_number, current_guidance: currentGuidance, guidance,
    changed: JSON.stringify(guidance) !== JSON.stringify(currentGuidance) } }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > CLASSROOM_GUIDANCE_PREVIEW_WIRE_BYTES) throw unavailable()
  return result
}

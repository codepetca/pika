import { ApiError } from '@/lib/api-error'
import type { getServiceRoleClient } from '@/lib/supabase'
import { buildCourseBlueprintSnapshot, canonicalizeCourseBlueprintSnapshot, hashCourseBlueprintSnapshot } from '@/lib/server/course-blueprint-versions'
import { CLASSROOM_GUIDANCE_ADOPTION_WIRE_BYTES as cap, contextualClassroomGuidanceAdoptionInputSchema,
  contextualClassroomGuidanceAdoptionQuerySchema, contextualClassroomGuidanceAdoptionSourceSuccessSchema,
  contextualClassroomGuidanceAdoptionWriteSuccessSchema, contextualClassroomGuidanceAdoptionFailureSchema,
  sourceToSnapshotInput } from '@/lib/validations/contextual-classroom-guidance-adoption'

const unavailable = () => new ApiError(503, 'Unable to verify classroom guidance adoption')
// The writer may have committed before a lost or invalid response. This error
// deliberately makes no rollback claim and must not trigger retry/compensation.
const uncertain = () => new ApiError(503, 'Unable to confirm classroom guidance adoption')
const changed = 'Classroom or Blueprint changed; review the latest guidance and try again'
function checkFailure(response: unknown, write = false) {
  const failure = contextualClassroomGuidanceAdoptionFailureSchema.safeParse(response)
  if (!failure.success) return
  const { status, error: { code, message } } = failure.data
  if (status === 400 && code === 'PT400' && message === 'class_guidance_adoption_invalid_argument') throw new ApiError(400, 'Invalid classroom guidance adoption request')
  if (status === 404 && code === 'PT404' && message === 'class_guidance_adoption_classroom_missing') throw new ApiError(404, 'Classroom not found')
  if (status === 404 && code === 'PT404' && message === 'class_guidance_adoption_blueprint_missing') throw new ApiError(404, 'Course blueprint not found')
  if (status === 403 && code === 'PT403' && message === 'class_guidance_adoption_forbidden') throw new ApiError(403, 'Forbidden')
  if (status === 403 && code === 'PT403' && message === 'class_guidance_adoption_archived') throw new ApiError(403, 'Classroom is archived')
  if (status === 409 && code === 'PT409' && ['class_guidance_adoption_unlinked', 'class_guidance_adoption_changed', 'class_guidance_adoption_busy'].includes(message)) throw new ApiError(409, changed)
  throw write ? uncertain() : unavailable()
}
const withinWire = (value: unknown) => {
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8') <= cap } catch { return false }
}

/** Complete source -> existing canonical builder -> one atomic database write.
 * No legacy helper, separately committed save, provider call or retry is used. */
export async function adoptContextualClassroomGuidance(input: {
  supabase: ReturnType<typeof getServiceRoleClient>; actorId: string; classroomId: string; input: unknown
}) {
  const body = contextualClassroomGuidanceAdoptionInputSchema.safeParse(input.input)
  if (!body.success) throw new ApiError(400, 'Invalid classroom guidance adoption request')
  const parsed = contextualClassroomGuidanceAdoptionQuerySchema.safeParse({ actorId: input.actorId, classroomId: input.classroomId, ...body.data })
  if (!parsed.success) throw new ApiError(400, 'Invalid classroom guidance adoption request')
  const query = parsed.data
  const args = { p_actor_id: query.actorId, p_classroom_id: query.classroomId, p_blueprint_id: query.blueprint_id,
    p_expected_content_version_id: query.expected_content_version_id, p_expected_guidance_version_id: query.expected_guidance_version_id,
    p_expected_draft_revision: query.expected_draft_revision }
  let response: unknown
  try {
    response = await input.supabase.rpc('read_classroom_guidance_adoption_source_v1', args).abortSignal(AbortSignal.timeout(10_000))
    if (!withinWire(response)) throw unavailable()
  } catch { throw unavailable() }
  checkFailure(response)
  // Recursive persisted JSON can throw while decoding, even within the byte bound.
  let source: ReturnType<typeof contextualClassroomGuidanceAdoptionSourceSuccessSchema.safeParse>
  try { source = contextualClassroomGuidanceAdoptionSourceSuccessSchema.safeParse(response) } catch { throw unavailable() }
  if (!source.success) throw unavailable()
  const row = source.data.data, classroom = row.classroom, blueprint = row.source.blueprint
  if (row.actor_id !== query.actorId || row.classroom_id !== query.classroomId || classroom.id !== query.classroomId
    || classroom.teacher_id !== query.actorId || blueprint.teacher_id !== query.actorId || blueprint.id !== query.blueprint_id
    || blueprint.content_revision !== query.expected_draft_revision || classroom.source_blueprint_id !== query.blueprint_id
    || classroom.source_blueprint_version_id !== query.expected_content_version_id
    || (classroom.authoring_guidance_version_id ?? classroom.source_blueprint_version_id) !== query.expected_guidance_version_id
    || row.versions.content.id !== query.expected_content_version_id || row.versions.content.course_blueprint_id !== query.blueprint_id
    || row.versions.guidance.id !== query.expected_guidance_version_id || row.versions.guidance.course_blueprint_id !== query.blueprint_id) throw unavailable()
  let canonical: string, snapshotSha256: string
  try {
    const snapshot = buildCourseBlueprintSnapshot(sourceToSnapshotInput(row))
    canonical = canonicalizeCourseBlueprintSnapshot(snapshot)
    if (Buffer.byteLength(canonical, 'utf8') > cap) throw unavailable()
    snapshotSha256 = hashCourseBlueprintSnapshot(snapshot)
  } catch { throw unavailable() }
  const writeArgs = { ...args, p_source_sha256: row.source_sha256, p_snapshot_canonical: canonical, p_snapshot_sha256: snapshotSha256 }
  if (!withinWire(writeArgs)) throw unavailable()
  let result: unknown
  try {
    result = await input.supabase.rpc('save_and_adopt_classroom_guidance_for_owner_v1', writeArgs).abortSignal(AbortSignal.timeout(10_000))
    if (!withinWire(result)) throw uncertain()
  } catch { throw uncertain() }
  checkFailure(result, true)
  const written = contextualClassroomGuidanceAdoptionWriteSuccessSchema.safeParse(result)
  if (!written.success) throw uncertain()
  const saved = written.data.data, version = saved.guidance_version
  if (saved.actor_id !== query.actorId || saved.classroom_id !== query.classroomId || saved.blueprint_id !== query.blueprint_id
    || saved.content_version_id !== query.expected_content_version_id || saved.previous_guidance_version_id !== query.expected_guidance_version_id
    || saved.source_sha256 !== row.source_sha256 || version.course_blueprint_id !== query.blueprint_id
    || version.source_draft_revision !== query.expected_draft_revision || version.snapshot_sha256 !== snapshotSha256) throw uncertain()
  return { version: version.version_number }
}

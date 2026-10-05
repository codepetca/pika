import { ApiError } from '@/lib/api-error'
import {
  contextualBlueprintMaterialReadClassroomEnvelopeSchema,
  contextualBlueprintMaterialReadPayloadEnvelopeSchema,
  contextualBlueprintMaterialReadProjectionSchema,
  contextualBlueprintMaterialReadQuerySchema,
} from '@/lib/validations/contextual-classroom-blueprint-material-read'
import type { getServiceRoleClient } from '@/lib/supabase'
import type { ClassroomBlueprintMaterials } from '@/lib/validations/classroom-blueprint-materials'

const payloadSelect = 'id,teacher_id,source_blueprint_id,blueprint:course_blueprints!classrooms_source_blueprint_id_fkey(id,teacher_id,versions:course_blueprint_versions!course_blueprint_versions_course_blueprint_id_fkey(id,course_blueprint_id,version_number,snapshot_json))'
const unavailable = () => new ApiError(503, 'Unable to verify linked Blueprint materials')

/** Current classroom/link/Blueprint owners and version parent share one payload statement. */
export async function readContextualClassroomBlueprintMaterials(input: {
  supabase: ReturnType<typeof getServiceRoleClient>
  actorId: string
  classroomId: string
}): Promise<{ materials: ClassroomBlueprintMaterials | null }> {
  const parsed = contextualBlueprintMaterialReadQuerySchema.safeParse({ actorId: input.actorId, classroomId: input.classroomId })
  if (!parsed.success) throw new ApiError(400, 'Invalid linked Blueprint material query')
  const { actorId, classroomId } = parsed.data

  // This read distinguishes 404/403 only; it never authorizes the payload below.
  let preflightResult: unknown
  try {
    preflightResult = await input.supabase.from('classrooms')
      .select('id,teacher_id').eq('id', classroomId).maybeSingle()
  } catch { throw unavailable() }
  const preflight = contextualBlueprintMaterialReadClassroomEnvelopeSchema.safeParse(preflightResult)
  if (!preflight.success) throw unavailable()
  const classroom = preflight.data.data
  if (classroom === null) throw new ApiError(404, 'Classroom not found')
  if (classroom.id !== classroomId) throw unavailable()
  if (classroom.teacher_id !== actorId) throw new ApiError(403, 'Forbidden')

  let payloadResult: unknown
  try {
    // Left embeddings preserve no-link and unavailable-version distinctions. Do
    // not filter archive state: owners retain archived classroom read access.
    payloadResult = await input.supabase.from('classrooms').select(payloadSelect)
      .eq('id', classroomId).eq('teacher_id', actorId).eq('blueprint.teacher_id', actorId)
      .order('version_number', { ascending: false, referencedTable: 'blueprint.versions' })
      .limit(1, { referencedTable: 'blueprint.versions' }).maybeSingle()
  } catch { throw unavailable() }
  const payload = contextualBlueprintMaterialReadPayloadEnvelopeSchema.safeParse(payloadResult)
  if (!payload.success) throw unavailable()
  const row = payload.data.data
  if (row === null) throw new ApiError(403, 'Forbidden')
  if (row.id !== classroomId || row.teacher_id !== actorId) throw unavailable()
  if (row.source_blueprint_id === null) {
    if (row.blueprint !== null) throw unavailable()
    return { materials: null }
  }
  if (row.blueprint === null) throw new ApiError(404, 'Linked Blueprint not found')
  if (row.blueprint.id !== row.source_blueprint_id || row.blueprint.teacher_id !== actorId) throw unavailable()
  const version = row.blueprint.versions[0]
  if (!version || version.course_blueprint_id !== row.blueprint.id) throw unavailable()

  const projection = contextualBlueprintMaterialReadProjectionSchema.safeParse({
    version_id: version.id,
    version_number: version.version_number,
    materials: Object.prototype.hasOwnProperty.call(version.snapshot_json, 'materials')
      ? version.snapshot_json.materials : [],
  })
  if (!projection.success) throw unavailable()
  // Nothing else from the private reusable snapshot or binding evidence escapes.
  return { materials: { ...projection.data, materials: [...projection.data.materials].sort((a, b) => a.position - b.position) } }
}

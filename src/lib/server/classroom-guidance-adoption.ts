import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { getClassroomAuthoringGuidance } from '@/lib/server/classroom-authoring-guidance'
import { getCourseBlueprintDetail } from '@/lib/server/course-blueprints'
import { saveCourseBlueprintVersion } from '@/lib/server/course-blueprint-versions'
import { normalizeCourseBlueprintAuthoringGuidance } from '@/lib/course-blueprint-authoring-guidance'
import type { ClassroomGuidanceAdoptionInput } from '@/lib/validations/classroom-guidance-adoption'

/** Owned live Draft is exposed only in this explicit teacher preview flow. */
export async function previewClassroomGuidanceAdoption(teacherId: string, classroomId: string) {
  const permission = await assertTeacherCanMutateClassroom(teacherId, classroomId)
  if (!permission.ok) return permission
  const current = await getClassroomAuthoringGuidance(teacherId, classroomId)
  if (!current.ok) return current
  if (!current.context) return { ok: false as const, status: 409, error: 'No Blueprint Version linked' }
  const { detail, error, status } = await getCourseBlueprintDetail(teacherId, current.context.blueprint_id)
  if (!detail) return { ok: false as const, status: status ?? 404, error: error ?? 'Blueprint unavailable' }
  const guidance = normalizeCourseBlueprintAuthoringGuidance(detail.authoring_guidance)
  return {
    ok: true as const,
    preview: {
      blueprint_id: detail.id,
      expected_content_version_id: current.context.content_version_id,
      expected_guidance_version_id: current.context.source_blueprint_version_id,
      expected_draft_revision: detail.content_revision,
      current_guidance: current.context.guidance,
      guidance,
      changed: JSON.stringify(guidance) !== JSON.stringify(current.context.guidance),
    },
  }
}

export async function adoptClassroomGuidance(
  teacherId: string, classroomId: string, input: ClassroomGuidanceAdoptionInput,
) {
  const permission = await assertTeacherCanMutateClassroom(teacherId, classroomId)
  if (!permission.ok) return permission
  const current = await getClassroomAuthoringGuidance(teacherId, classroomId)
  if (!current.ok) return current
  if (!current.context || current.context.blueprint_id !== input.blueprint_id
    || current.context.content_version_id !== input.expected_content_version_id
    || current.context.source_blueprint_version_id !== input.expected_guidance_version_id) {
    return { ok: false as const, status: 409, error: 'Classroom Blueprint changed; review and retry' }
  }
  const { detail, error, status } = await getCourseBlueprintDetail(teacherId, input.blueprint_id)
  if (!detail) return { ok: false as const, status: status ?? 404, error: error ?? 'Blueprint unavailable' }
  if (detail.content_revision !== input.expected_draft_revision) {
    return { ok: false as const, status: 409, error: 'Blueprint Draft changed; review the latest guidance' }
  }
  const supabase = getServiceRoleClient()
  const saved = await saveCourseBlueprintVersion({ supabase, teacherId, detail })
  if (!saved.ok) return saved
  const result = await supabase.rpc('adopt_classroom_authoring_guidance_v1', {
    p_actor_id: teacherId, p_classroom_id: classroomId, p_blueprint_id: input.blueprint_id,
    p_expected_content_version_id: input.expected_content_version_id,
    p_expected_guidance_version_id: input.expected_guidance_version_id,
    p_expected_draft_revision: input.expected_draft_revision,
    p_guidance_version_id: saved.version.id,
  })
  if (result.error) {
    const code = result.error.code
    return { ok: false as const,
      status: code === '42501' ? 403 : code === 'P0002' ? 404
        : ['40001', '55000', '23514'].includes(code) ? 409 : 500,
      error: ['40001', '55000', '23514'].includes(code)
        ? 'Classroom or Blueprint changed; review the latest guidance and try again'
        : 'Could not update classroom guidance',
    }
  }
  return { ok: true as const, version: saved.version.version_number }
}

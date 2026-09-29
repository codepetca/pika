import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import {
  normalizeCourseBlueprintAuthoringGuidance,
  type CourseBlueprintAuthoringGuidance,
} from '@/lib/course-blueprint-authoring-guidance'

export type ClassroomAuthoringGuidance = {
  source_blueprint_version_id: string
  source_blueprint_version_number: number
  source_draft_revision: number
  guidance: CourseBlueprintAuthoringGuidance
}

/** Resolve the immutable version used to create this classroom, never the live Draft. */
export async function getClassroomAuthoringGuidance(
  teacherId: string,
  classroomId: string,
): Promise<
  | { ok: true; context: ClassroomAuthoringGuidance | null }
  | { ok: false; status: number; error: string }
> {
  const supabase = getServiceRoleClient()
  const ownership = await assertTeacherOwnsClassroom(teacherId, classroomId, { supabase })
  if (!ownership.ok) return ownership

  const { data: classroom, error: classroomError } = await supabase
    .from('classrooms')
    .select('source_blueprint_id,source_blueprint_version_id')
    .eq('id', classroomId)
    .eq('teacher_id', teacherId)
    .single()
  if (classroomError || !classroom) {
    return { ok: false, status: 500, error: 'Failed to load classroom Blueprint source' }
  }
  if (!classroom.source_blueprint_id || !classroom.source_blueprint_version_id) {
    return { ok: true, context: null }
  }

  const { data: version, error: versionError } = await supabase
    .from('course_blueprint_versions')
    .select('id,course_blueprint_id,version_number,source_draft_revision,snapshot_json')
    .eq('id', classroom.source_blueprint_version_id)
    .eq('course_blueprint_id', classroom.source_blueprint_id)
    .single()
  if (versionError || !version) {
    return { ok: false, status: 500, error: 'Classroom Blueprint Version is unavailable' }
  }

  const snapshot = version.snapshot_json
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { ok: false, status: 500, error: 'Classroom Blueprint Version is invalid' }
  }
  try {
    return {
      ok: true,
      context: {
        source_blueprint_version_id: version.id,
        source_blueprint_version_number: Number(version.version_number),
        source_draft_revision: Number(version.source_draft_revision),
        guidance: normalizeCourseBlueprintAuthoringGuidance(
          'authoring_guidance' in snapshot ? snapshot.authoring_guidance : null,
        ),
      },
    }
  } catch {
    return { ok: false, status: 500, error: 'Classroom Blueprint guidance is invalid' }
  }
}

import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsCourseBlueprint } from '@/lib/server/course-blueprints'
import {
  normalizeCourseBlueprintAuthoringGuidance,
} from '@/lib/course-blueprint-authoring-guidance'
import type { CourseBlueprintGuidanceRevision } from '@/lib/course-blueprint-guidance-history'

export async function getCourseBlueprintGuidanceHistory(
  teacherId: string,
  blueprintId: string,
): Promise<
  | { ok: true; revisions: CourseBlueprintGuidanceRevision[] }
  | { ok: false; status: number; error: string }
> {
  const ownership = await assertTeacherOwnsCourseBlueprint(teacherId, blueprintId)
  if (!ownership.ok) return ownership
  const supabase = getServiceRoleClient()
  const { data, error } = await (supabase as any)
    .from('course_blueprint_authoring_guidance_revisions')
    .select('id,content_revision,source_kind,created_at,guidance')
    .eq('course_blueprint_id', blueprintId)
    .order('content_revision', { ascending: false })
    .limit(50)
  if (error) {
    return { ok: false, status: 500, error: 'Failed to load guidance history' }
  }
  try {
    const revisions = ((data || []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      content_revision: Number(row.content_revision),
      source_kind: row.source_kind as CourseBlueprintGuidanceRevision['source_kind'],
      created_at: String(row.created_at),
      guidance: normalizeCourseBlueprintAuthoringGuidance(row.guidance),
    }))
    return { ok: true, revisions }
  } catch {
    return { ok: false, status: 500, error: 'Guidance history is invalid' }
  }
}

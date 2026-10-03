import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import {
  classroomBlueprintMaterialsSchema,
  type ClassroomBlueprintMaterials,
} from '@/lib/validations/classroom-blueprint-materials'

/** Read the linked Blueprint's latest saved materials without adopting its content. */
export async function getClassroomBlueprintMaterials(teacherId: string, classroomId: string): Promise<
  | { ok: true; materials: ClassroomBlueprintMaterials | null }
  | { ok: false; status: number; error: string }
> {
  const supabase = getServiceRoleClient()
  const ownership = await assertTeacherOwnsClassroom(teacherId, classroomId, { supabase })
  if (!ownership.ok) return ownership

  const classroomResult = await supabase.from('classrooms')
    .select('source_blueprint_id')
    .eq('id', classroomId).eq('teacher_id', teacherId).single()
  if (classroomResult.error || !classroomResult.data) {
    return { ok: false, status: 500, error: 'Could not load the classroom Blueprint link' }
  }
  const blueprintId = classroomResult.data.source_blueprint_id
  if (!blueprintId) return { ok: true, materials: null }

  const blueprintResult = await supabase.from('course_blueprints')
    .select('id').eq('id', blueprintId).eq('teacher_id', teacherId).maybeSingle()
  if (blueprintResult.error) {
    return { ok: false, status: 500, error: 'Could not load Blueprint materials' }
  }
  if (!blueprintResult.data) {
    return { ok: false, status: 404, error: 'Linked Blueprint not found' }
  }

  const versionResult = await supabase.from('course_blueprint_versions')
    .select('id,version_number,snapshot_json')
    .eq('course_blueprint_id', blueprintId)
    .order('version_number', { ascending: false }).limit(1).maybeSingle()
  if (versionResult.error || !versionResult.data) {
    return { ok: false, status: 500, error: 'The latest saved Blueprint Version is unavailable' }
  }
  const version = versionResult.data
  const snapshot = version.snapshot_json
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { ok: false, status: 500, error: 'Blueprint materials are invalid' }
  }
  const parsed = classroomBlueprintMaterialsSchema.safeParse({
    version_id: version.id,
    version_number: version.version_number,
    // Historical snapshots predate Materials; malformed present fields still fail closed.
    materials: 'materials' in snapshot ? snapshot.materials : [],
  })
  if (!parsed.success) {
    return { ok: false, status: 500, error: 'Blueprint materials are invalid' }
  }
  return {
    ok: true,
    materials: { ...parsed.data, materials: parsed.data.materials.sort((a, b) => a.position - b.position) },
  }
}

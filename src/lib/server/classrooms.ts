import { getServiceRoleClient } from '@/lib/supabase'
import {
  DEFAULT_ACTUAL_COURSE_SITE_CONFIG,
  normalizeActualCourseSiteConfig,
} from '@/lib/course-site-publishing'
import type { Classroom } from '@/types'

export type ClassroomAccessRecord = {
  id: string
  teacher_id: string
  archived_at: string | null
  actual_site_slug: string | null
  actual_site_published: boolean
}

export function hydrateClassroomRecord(row: Record<string, any>): Classroom {
  return {
    ...(row as Classroom),
    source_blueprint_id: row.source_blueprint_id ?? null,
    source_blueprint_origin: row.source_blueprint_origin ?? null,
    actual_site_slug: row.actual_site_slug ?? null,
    actual_site_published: !!row.actual_site_published,
    actual_site_config: normalizeActualCourseSiteConfig(
      row.actual_site_config ?? DEFAULT_ACTUAL_COURSE_SITE_CONFIG
    ),
    course_overview_markdown: row.course_overview_markdown ?? '',
    course_outline_markdown: row.course_outline_markdown ?? '',
    codepetpal_enabled: !!row.codepetpal_enabled,
  }
}

type AccessResult<T> =
  | { ok: true; classroom: T }
  | { ok: false; status: number; error: string }

export async function assertTeacherOwnsClassroom(
  teacherId: string,
  classroomId: string
): Promise<AccessResult<ClassroomAccessRecord>> {
  const supabase = getServiceRoleClient()
  const { data: classroom, error } = await supabase
    .from('classrooms')
    .select('id, teacher_id, archived_at, actual_site_slug, actual_site_published')
    .eq('id', classroomId)
    .single()

  if (error || !classroom) {
    return { ok: false, status: 404, error: 'Classroom not found' }
  }

  if (classroom.teacher_id !== teacherId) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }

  return { ok: true, classroom }
}

export async function assertTeacherCanMutateClassroom(
  teacherId: string,
  classroomId: string
): Promise<AccessResult<ClassroomAccessRecord>> {
  const ownership = await assertTeacherOwnsClassroom(teacherId, classroomId)
  if (!ownership.ok) {
    return ownership
  }

  if (ownership.classroom.archived_at) {
    return { ok: false, status: 403, error: 'Classroom is archived' }
  }

  return ownership
}

export async function assertStudentCanAccessClassroom(
  studentId: string,
  classroomId: string
): Promise<AccessResult<{ id: string; archived_at: string | null }>> {
  const supabase = getServiceRoleClient()
  const { data: classroom, error: classroomError } = await supabase
    .from('classrooms')
    .select('id, archived_at')
    .eq('id', classroomId)
    .single()

  if (classroomError || !classroom) {
    return { ok: false, status: 404, error: 'Classroom not found' }
  }

  if (classroom.archived_at) {
    return { ok: false, status: 403, error: 'Classroom is archived' }
  }

  const { data: enrollment, error: enrollError } = await supabase
    .from('classroom_enrollments')
    .select('id')
    .eq('classroom_id', classroomId)
    .eq('student_id', studentId)
    .single()

  if (enrollError || !enrollment) {
    return { ok: false, status: 403, error: 'Not enrolled in this classroom' }
  }

  return { ok: true, classroom }
}

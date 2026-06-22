import { getServiceRoleClient } from '@/lib/supabase'
import {
  DEFAULT_ACTUAL_COURSE_SITE_CONFIG,
  normalizeActualCourseSiteConfig,
} from '@/lib/course-site-publishing'
import {
  getLeastUsedClassroomThemeColor,
  isClassroomThemeColor,
  normalizeClassroomThemeColor,
} from '@/lib/classroom-theme'
import type { Classroom } from '@/types'

type SupabaseClient = ReturnType<typeof getServiceRoleClient>

export type ClassroomAccessRecord = {
  id: string
  title: string
  teacher_id: string
  archived_at: string | null
  actual_site_slug: string | null
  actual_site_published: boolean
}

export function hydrateClassroomRecord(row: Record<string, any>): Classroom {
  return {
    ...(row as Classroom),
    theme_color: normalizeClassroomThemeColor(row.theme_color),
    source_blueprint_id: row.source_blueprint_id ?? null,
    source_blueprint_origin: row.source_blueprint_origin ?? null,
    actual_site_slug: row.actual_site_slug ?? null,
    actual_site_published: !!row.actual_site_published,
    actual_site_config: normalizeActualCourseSiteConfig(
      row.actual_site_config ?? DEFAULT_ACTUAL_COURSE_SITE_CONFIG
    ),
    join_policy: row.join_policy === 'open_join' ? 'open_join' : 'roster',
    course_overview_markdown: row.course_overview_markdown ?? '',
    course_outline_markdown: row.course_outline_markdown ?? '',
  }
}

export function hydrateClassroomRecords(rows: Record<string, any>[]): Classroom[] {
  const assignedThemeColors: string[] = []

  return rows.map((row) => {
    const themeColor = isClassroomThemeColor(row.theme_color)
      ? row.theme_color
      : getLeastUsedClassroomThemeColor(assignedThemeColors)
    assignedThemeColors.push(themeColor)
    return hydrateClassroomRecord({ ...row, theme_color: themeColor })
  })
}

type AccessResult<T> =
  | { ok: true; classroom: T }
  | { ok: false; status: number; error: string }

type ClassroomAccessOptions = {
  supabase?: SupabaseClient
}

export async function assertTeacherOwnsClassroom(
  teacherId: string,
  classroomId: string,
  options: ClassroomAccessOptions = {},
): Promise<AccessResult<ClassroomAccessRecord>> {
  const supabase = options.supabase ?? getServiceRoleClient()
  const { data: classroom, error } = await supabase
    .from('classrooms')
    .select('id, title, teacher_id, archived_at, actual_site_slug, actual_site_published')
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
  classroomId: string,
  options: ClassroomAccessOptions = {},
): Promise<AccessResult<ClassroomAccessRecord>> {
  const ownership = await assertTeacherOwnsClassroom(teacherId, classroomId, options)
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

export async function getClassroomStudentIds(
  supabase: any,
  classroomId: string
): Promise<{ studentIds: string[]; studentIdSet: Set<string>; totalStudents: number; error: unknown }> {
  const pageSize = 1000
  const studentIds = new Set<string>()
  let totalStudents: number | null = null
  let offset = 0

  while (true) {
    let query = supabase
      .from('classroom_enrollments')
      .select('student_id', { count: 'exact' })
      .eq('classroom_id', classroomId)

    const supportsRange = typeof query.range === 'function'
    if (typeof query.order === 'function') {
      query = query.order('student_id', { ascending: true })
    }
    if (supportsRange) {
      query = query.range(offset, offset + pageSize - 1)
    }

    const { data, error, count } = await query

    if (error) {
      return { studentIds: [], studentIdSet: new Set(), totalStudents: 0, error }
    }

    if (typeof count === 'number') {
      totalStudents = count
    }

    for (const row of (data || []) as Array<{ student_id: unknown }>) {
      if (typeof row.student_id === 'string' && row.student_id.length > 0) {
        studentIds.add(row.student_id)
      }
    }

    if (!supportsRange || (data || []).length < pageSize) break
    if (totalStudents !== null && offset + pageSize >= totalStudents) break
    offset += pageSize
  }

  const sortedStudentIds = Array.from(studentIds)

  return {
    studentIds: sortedStudentIds,
    studentIdSet: new Set(sortedStudentIds),
    totalStudents: totalStudents ?? sortedStudentIds.length,
    error: null,
  }
}

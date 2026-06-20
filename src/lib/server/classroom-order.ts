import { getServiceRoleClient } from '@/lib/supabase'

type SupabaseClient = ReturnType<typeof getServiceRoleClient>

const ACTIVE_TEACHER_CLASSROOM_SELECT_WITH_THEME = [
  'id',
  'title',
  'class_code',
  'theme_color',
  'term_label',
  'updated_at',
  'archived_at',
  'position',
].join(',')

const ACTIVE_TEACHER_CLASSROOM_SELECT_LEGACY = [
  'id',
  'title',
  'class_code',
  'term_label',
  'updated_at',
  'archived_at',
  'position',
].join(',')

function isMissingThemeColorError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const message = 'message' in error ? String((error as { message?: unknown }).message ?? '') : ''
  return message.includes('theme_color')
}

export async function listActiveTeacherClassrooms(supabase: SupabaseClient, teacherId: string) {
  const withPosition = await supabase
    .from('classrooms')
    .select(ACTIVE_TEACHER_CLASSROOM_SELECT_WITH_THEME)
    .eq('teacher_id', teacherId)
    .is('archived_at', null)
    .order('position', { ascending: true })
    .order('updated_at', { ascending: false })

  if (!withPosition.error) {
    return withPosition
  }

  const byUpdatedAt = await supabase
    .from('classrooms')
    .select(ACTIVE_TEACHER_CLASSROOM_SELECT_WITH_THEME)
    .eq('teacher_id', teacherId)
    .is('archived_at', null)
    .order('updated_at', { ascending: false })

  if (!byUpdatedAt.error || !isMissingThemeColorError(byUpdatedAt.error)) {
    return byUpdatedAt
  }

  const legacyWithPosition = await supabase
    .from('classrooms')
    .select(ACTIVE_TEACHER_CLASSROOM_SELECT_LEGACY)
    .eq('teacher_id', teacherId)
    .is('archived_at', null)
    .order('position', { ascending: true })
    .order('updated_at', { ascending: false })

  if (!legacyWithPosition.error) {
    return legacyWithPosition
  }

  return supabase
    .from('classrooms')
    .select(ACTIVE_TEACHER_CLASSROOM_SELECT_LEGACY)
    .eq('teacher_id', teacherId)
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
}

export async function getNextTeacherClassroomPosition(
  supabase: SupabaseClient,
  teacherId: string
): Promise<number | null> {
  const firstClassroomResult = await supabase
    .from('classrooms')
    .select('position')
    .eq('teacher_id', teacherId)
    .is('archived_at', null)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (firstClassroomResult.error) {
    return null
  }

  return typeof firstClassroomResult.data?.position === 'number'
    ? firstClassroomResult.data.position - 1
    : 0
}

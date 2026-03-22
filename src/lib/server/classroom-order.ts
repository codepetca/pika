import { getServiceRoleClient } from '@/lib/supabase'

type SupabaseClient = ReturnType<typeof getServiceRoleClient>

export async function listActiveTeacherClassrooms(supabase: SupabaseClient, teacherId: string) {
  const withPosition = await supabase
    .from('classrooms')
    .select('*')
    .eq('teacher_id', teacherId)
    .is('archived_at', null)
    .order('position', { ascending: true })
    .order('updated_at', { ascending: false })

  if (!withPosition.error) {
    return withPosition
  }

  return supabase
    .from('classrooms')
    .select('*')
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

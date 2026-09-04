import { getServiceRoleClient } from '@/lib/supabase'
import type { Json } from '@/types/database.generated'

/**
 * Reads one teacher's stored value for a UI-state key (onboarding
 * dismissal/progress, or any future one-time guidance). Returns null when
 * nothing has been stored yet — callers treat that as "not seen".
 */
export async function fetchTeacherUiState(teacherId: string, key: string) {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase
    .from('teacher_ui_state')
    .select('value, updated_at')
    .eq('teacher_id', teacherId)
    .eq('key', key)
    .maybeSingle()

  return { value: data?.value ?? null, error }
}

/**
 * Upserts one teacher's value for a UI-state key.
 */
export async function upsertTeacherUiState(teacherId: string, key: string, value: Json) {
  const supabase = getServiceRoleClient()
  const { error } = await supabase
    .from('teacher_ui_state')
    .upsert(
      { teacher_id: teacherId, key, value, updated_at: new Date().toISOString() },
      { onConflict: 'teacher_id,key' },
    )

  return { error }
}

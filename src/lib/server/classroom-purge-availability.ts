import { z } from 'zod'
import { getServiceRoleClient } from '@/lib/supabase'

type ServiceClient = ReturnType<typeof getServiceRoleClient>

const classroomIdsSchema = z.array(z.string().uuid())
const managedSettingsSchema = z.object({
  mode: z.string(),
}).strict()
const purgeSettingsSchema = z.object({
  rollout_mode: z.enum(['disabled', 'canary', 'enabled']),
  canary_teacher_id: z.string().uuid().nullable(),
  canary_classroom_id: z.string().uuid().nullable(),
}).strict()

/**
 * Returns only the already-visible hot classroom ids whose database rollout
 * gate is open for this teacher. This is a fail-closed presentation hint; the
 * purge RPC remains the final authorization and concurrency boundary.
 */
export async function listHotClassroomPurgeEnabledIds(args: {
  supabase: ServiceClient
  teacherId: string
  hotClassroomIds: string[]
}): Promise<string[]> {
  const teacherId = z.string().uuid().parse(args.teacherId)
  const hotClassroomIds = classroomIdsSchema.parse(args.hotClassroomIds)
  if (hotClassroomIds.length === 0) return []

  const [managedResponse, purgeResponse] = await Promise.all([
    args.supabase
      .from('managed_storage_settings')
      .select('mode')
      .eq('singleton', true)
      .maybeSingle(),
    args.supabase
      .from('classroom_purge_settings')
      .select('rollout_mode,canary_teacher_id,canary_classroom_id')
      .eq('singleton', true)
      .maybeSingle(),
  ])

  // Code may deploy before migration 118. Any missing table, malformed row,
  // or transient read failure hides the irreversible action without affecting
  // the ordinary archive list.
  if (managedResponse.error || purgeResponse.error) return []
  const managed = managedSettingsSchema.safeParse(managedResponse.data)
  const purge = purgeSettingsSchema.safeParse(purgeResponse.data)
  if (!managed.success || !purge.success || managed.data.mode !== 'enforced') return []

  if (purge.data.rollout_mode === 'enabled') return hotClassroomIds
  if (
    purge.data.rollout_mode === 'canary'
    && purge.data.canary_teacher_id === teacherId
    && purge.data.canary_classroom_id
    && hotClassroomIds.includes(purge.data.canary_classroom_id)
  ) {
    return [purge.data.canary_classroom_id]
  }
  return []
}

/**
 * Returns only visible cold tombstones whose independent rollout gate is open.
 * Restore availability is intentionally unrelated to deletion availability.
 */
export async function listColdClassroomPurgeEnabledIds(args: {
  supabase: ServiceClient
  teacherId: string
  coldClassroomIds: string[]
}): Promise<string[]> {
  const teacherId = z.string().uuid().parse(args.teacherId)
  const coldClassroomIds = classroomIdsSchema.parse(args.coldClassroomIds)
  if (coldClassroomIds.length === 0) return []

  const [managedResponse, purgeResponse] = await Promise.all([
    args.supabase
      .from('managed_storage_settings')
      .select('mode')
      .eq('singleton', true)
      .maybeSingle(),
    args.supabase
      .from('cold_classroom_purge_settings' as never)
      .select('rollout_mode,canary_teacher_id,canary_classroom_id')
      .eq('singleton', true)
      .maybeSingle(),
  ])

  if (managedResponse.error || purgeResponse.error) return []
  const managed = managedSettingsSchema.safeParse(managedResponse.data)
  const purge = purgeSettingsSchema.safeParse(purgeResponse.data)
  if (!managed.success || !purge.success || managed.data.mode !== 'enforced') return []

  if (purge.data.rollout_mode === 'enabled') return coldClassroomIds
  if (
    purge.data.rollout_mode === 'canary'
    && purge.data.canary_teacher_id === teacherId
    && purge.data.canary_classroom_id
    && coldClassroomIds.includes(purge.data.canary_classroom_id)
  ) {
    return [purge.data.canary_classroom_id]
  }
  return []
}

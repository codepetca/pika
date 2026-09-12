import type { getServiceRoleClient } from '@/lib/supabase'

// Temporary migration-169 adapter until the exact migration is authorized on
// the existing local schema and public types can be regenerated canonically.
type ClassroomPalRpcArgs = {
  resolve_pal_classroom_context: { p_student_id: string; p_classroom_id: string }
  record_pal_classroom_visit: { p_student_id: string; p_classroom_id: string }
  authorize_pal_membership_delivery: { p_outbox_id: string; p_lease_token: string }
  claim_pal_membership_outbox: { p_limit: number; p_lease_seconds: number; p_student_id?: string; p_classroom_id?: string }
  count_pal_membership_outbox_ready: undefined
  sync_pal_membership_weeks: { p_limit: number }
}

export function classroomPalRpc<Name extends keyof ClassroomPalRpcArgs>(
  client: Pick<ReturnType<typeof getServiceRoleClient>, 'rpc'>,
  name: Name,
  args: ClassroomPalRpcArgs[Name],
): PromiseLike<{ data: unknown; error: unknown }> {
  const rpc = client.rpc as unknown as (
    name: Name, args: ClassroomPalRpcArgs[Name],
  ) => PromiseLike<{ data: unknown; error: unknown }>
  return rpc.call(client, name, args)
}

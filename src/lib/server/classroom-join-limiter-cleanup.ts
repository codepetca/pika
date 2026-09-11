import { getServiceRoleClient } from '@/lib/supabase'

const BATCH_SIZE = 10_000

// Migration 159 owns the one-day retention boundary and skips locked rows.
// One bounded call keeps this work within the shared nightly cron budget.
export async function cleanupClassroomJoinLimiter(
  supabase: ReturnType<typeof getServiceRoleClient>,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('cleanup_classroom_join_rate_limits_v1', {
      p_batch_size: BATCH_SIZE,
    })
    if (error || !Number.isSafeInteger(data) || data < 0 || data > BATCH_SIZE) {
      console.error('[classroom-join-limiter-cleanup] failed')
      return false
    }
    console.info('[classroom-join-limiter-cleanup] completed', { deleted: data })
    // A full batch cannot establish that maintenance is keeping up. Surface it
    // through the cron failure ledger instead of silently declaring success.
    return data < BATCH_SIZE
  } catch {
    console.error('[classroom-join-limiter-cleanup] failed')
    return false
  }
}

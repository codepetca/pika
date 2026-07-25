import { getServiceRoleClient } from '@/lib/supabase'
import { isPalEnabled } from '@/lib/server/pal-config'

type SupabaseLike = any

const STATUSES = ['pending', 'processing', 'delivered', 'non_retryable'] as const

export async function loadPalOutboxStatus(input: {
  supabase?: SupabaseLike
} = {}) {
  const supabase = input.supabase ?? getServiceRoleClient()
  const counts: Record<(typeof STATUSES)[number], number> = {
    pending: 0,
    processing: 0,
    delivered: 0,
    non_retryable: 0,
  }

  for (const status of STATUSES) {
    const { count, error } = await supabase
      .from('pal_event_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('status', status)
    if (error) {
      throw new Error(`Failed to load Pal outbox ${status} count: ${error.message}`)
    }
    counts[status] = count ?? 0
  }

  const { data, error } = await supabase
    .from('pal_event_outbox')
    .select(
      'id, event_type, status, attempts, next_attempt_at, last_attempt_at, last_error_code, last_error_detail, created_at, updated_at',
    )
    .in('status', ['pending', 'processing', 'non_retryable'])
    .order('created_at', { ascending: true })
    .limit(25)
  if (error) {
    throw new Error(`Failed to load Pal outbox exceptions: ${error.message}`)
  }

  return {
    enabled: isPalEnabled(),
    counts,
    exceptions: data ?? [],
  }
}

export async function requeuePalOutboxEvent(input: {
  outboxId: string
  supabase?: SupabaseLike
}): Promise<boolean> {
  const supabase = input.supabase ?? getServiceRoleClient()
  const { data, error } = await supabase.rpc('requeue_pal_event_outbox', {
    p_outbox_id: input.outboxId,
  })
  if (error) {
    throw new Error(`Failed to requeue Pal outbox event: ${error.message}`)
  }
  return data === true
}

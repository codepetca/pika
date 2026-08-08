import { getServiceRoleClient } from '@/lib/supabase'
import { isPalEnabled } from '@/lib/server/pal-config'

type PalOperationsClient = ReturnType<typeof getServiceRoleClient>

const STATUSES = ['pending', 'processing', 'delivered', 'non_retryable'] as const

export async function loadPalOutboxStatus(input: {
  supabase?: PalOperationsClient
  now?: Date
} = {}) {
  const supabase = input.supabase ?? getServiceRoleClient()
  const now = input.now ?? new Date()
  const nowIso = now.toISOString()
  const sinceIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const counts: Record<(typeof STATUSES)[number], number> = {
    pending: 0,
    processing: 0,
    delivered: 0,
    non_retryable: 0,
  }

  const countPromises = STATUSES.map((status) => supabase
      .from('pal_event_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('status', status))

  const [
    countResults,
    exceptionsResult,
    retryingResult,
    expiredResult,
    oldestPendingResult,
    oldestExpiredResult,
    deliveriesResult,
    readyResult,
  ] = await Promise.all([
    Promise.all(countPromises),
    supabase
      .from('pal_event_outbox')
      .select(
        'id, event_type, status, attempts, next_attempt_at, last_attempt_at, last_error_code, last_error_detail, created_at, updated_at',
      )
      .in('status', ['pending', 'processing', 'non_retryable'])
      .order('created_at', { ascending: true })
      .limit(25),
    supabase
      .from('pal_event_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .gt('attempts', 0),
    supabase
      .from('pal_event_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'processing')
      .lte('lease_expires_at', nowIso),
    supabase
      .from('pal_event_outbox')
      .select('next_attempt_at')
      .eq('status', 'pending')
      .lte('next_attempt_at', nowIso)
      .order('next_attempt_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('pal_event_outbox')
      .select('lease_expires_at')
      .eq('status', 'processing')
      .lte('lease_expires_at', nowIso)
      .order('lease_expires_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('pal_event_outbox')
      .select('created_at, delivered_at')
      .eq('status', 'delivered')
      .not('delivered_at', 'is', null)
      .gte('delivered_at', sinceIso)
      .order('delivered_at', { ascending: false })
      .limit(500),
    supabase.rpc('count_pal_event_outbox_ready'),
  ])

  for (let index = 0; index < STATUSES.length; index += 1) {
    const status = STATUSES[index]
    const { count, error } = countResults[index]
    if (error) {
      throw new Error(`Failed to load Pal outbox ${status} count: ${error.message}`)
    }
    counts[status] = count ?? 0
  }

  const namedResults = [
    ['exceptions', exceptionsResult],
    ['retrying count', retryingResult],
    ['expired lease count', expiredResult],
    ['oldest pending row', oldestPendingResult],
    ['oldest expired row', oldestExpiredResult],
    ['recent delivery latency', deliveriesResult],
    ['ready count', readyResult],
  ] as const
  for (const [label, result] of namedResults) {
    if (result.error) {
      throw new Error(`Failed to load Pal outbox ${label}: ${result.error.message}`)
    }
  }

  const timestamp = (value: unknown): number | null => {
    if (typeof value !== 'string') return null
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  const readyTimestamps = [
    [oldestPendingResult.data, 'next_attempt_at'],
    [oldestExpiredResult.data, 'lease_expires_at'],
  ] as const
  const oldestCandidates = readyTimestamps.map(([row, field]) => {
    const readyAt = row && typeof row === 'object' && field in row
      ? (row as Record<typeof field, unknown>)[field]
      : null
    return { value: readyAt, milliseconds: timestamp(readyAt) }
  }).filter((candidate): candidate is { value: string; milliseconds: number } =>
    typeof candidate.value === 'string' && candidate.milliseconds !== null)
  oldestCandidates.sort((left, right) => left.milliseconds - right.milliseconds)
  const oldestReadyAt = oldestCandidates[0]?.value ?? null
  const oldestReadyMs = oldestCandidates[0]?.milliseconds ?? null

  const latencies = (deliveriesResult.data ?? []).flatMap((row) => {
    const createdAt = timestamp(row.created_at)
    const deliveredAt = timestamp(row.delivered_at)
    if (createdAt === null || deliveredAt === null || deliveredAt < createdAt) return []
    return [Math.round(deliveredAt - createdAt)]
  }).sort((left, right) => left - right)
  const percentile = (fraction: number): number | null => {
    if (latencies.length === 0) return null
    return latencies[Math.max(0, Math.ceil(latencies.length * fraction) - 1)]
  }

  return {
    enabled: isPalEnabled(),
    counts,
    observability: {
      ready: readyResult.data ?? 0,
      retrying: retryingResult.count ?? 0,
      expired_leases: expiredResult.count ?? 0,
      oldest_ready_at: oldestReadyAt,
      oldest_ready_age_seconds: oldestReadyMs === null
        ? null
        : Math.max(0, Math.floor((now.getTime() - oldestReadyMs) / 1_000)),
      delivery_latency_24h: {
        sample_size: latencies.length,
        p50_ms: percentile(0.5),
        p95_ms: percentile(0.95),
        max_ms: latencies.at(-1) ?? null,
      },
    },
    exceptions: exceptionsResult.data ?? [],
  }
}

export async function requeuePalOutboxEvent(input: {
  outboxId: string
  supabase?: PalOperationsClient
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

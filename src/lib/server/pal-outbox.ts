import { z } from 'zod'

import { getServiceRoleClient } from '@/lib/supabase'
import { isPalEnabled, requirePalEnvironment } from '@/lib/server/pal-config'
import { v1 } from '@/vendor/pal-contract'

export type PalOutboxClient = Pick<
  ReturnType<typeof getServiceRoleClient>,
  'rpc'
>

const claimedOutboxRowSchema = z.object({
  id: z.string().uuid(),
  payload: z.unknown(),
  attempts: z.number().int().positive(),
  lease_token: z.string().uuid(),
}).passthrough()

export type PalOutboxDeliverySummary = {
  status: 'disabled' | 'ok'
  claimed: number
  delivered: number
  retrying: number
  nonRetryable: number
}

export type PalOutboxDrainSummary = PalOutboxDeliverySummary & {
  batches: number
  remainingReady: number
  stoppedReason: 'disabled' | 'empty' | 'drained' | 'batch_limit' | 'time_limit'
}

function retryDelayMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 6 * 60 * 60 * 1000)
}

function retryAt(attempts: number, now: Date): string {
  return new Date(now.getTime() + retryDelayMs(attempts)).toISOString()
}

type PalOutboxTransition =
  | {
    functionName: 'complete_pal_event_outbox'
    args: {
      p_outbox_id: string
      p_lease_token: string
    }
  }
  | {
    functionName: 'retry_pal_event_outbox'
    args: {
      p_outbox_id: string
      p_lease_token: string
      p_next_attempt_at: string
      p_error_code: string
      p_error_detail: string
    }
  }
  | {
    functionName: 'fail_pal_event_outbox'
    args: {
      p_outbox_id: string
      p_lease_token: string
      p_error_code: string
      p_error_detail: string
    }
  }

async function transition(
  supabase: PalOutboxClient,
  transition: PalOutboxTransition,
): Promise<void> {
  let result: { data: boolean | null; error: { message?: string } | null }
  switch (transition.functionName) {
    case 'complete_pal_event_outbox':
      result = await supabase.rpc(transition.functionName, transition.args)
      break
    case 'retry_pal_event_outbox':
      result = await supabase.rpc(transition.functionName, transition.args)
      break
    case 'fail_pal_event_outbox':
      result = await supabase.rpc(transition.functionName, transition.args)
      break
  }
  const { data, error } = result
  if (error) {
    throw new Error(`Failed to transition Pal outbox row: ${error.message ?? 'unknown error'}`)
  }
  if (data !== true) {
    throw new Error('Pal outbox lease was lost before delivery state could be recorded')
  }
}

async function markRetry(
  supabase: PalOutboxClient,
  row: z.infer<typeof claimedOutboxRowSchema>,
  now: Date,
  errorCode: string,
  errorDetail: string,
): Promise<void> {
  await transition(supabase, {
    functionName: 'retry_pal_event_outbox',
    args: {
      p_outbox_id: row.id,
      p_lease_token: row.lease_token,
      p_next_attempt_at: retryAt(row.attempts, now),
      p_error_code: errorCode,
      p_error_detail: errorDetail,
    },
  })
}

async function markNonRetryable(
  supabase: PalOutboxClient,
  row: z.infer<typeof claimedOutboxRowSchema>,
  errorCode: string,
  errorDetail: string,
): Promise<void> {
  await transition(supabase, {
    functionName: 'fail_pal_event_outbox',
    args: {
      p_outbox_id: row.id,
      p_lease_token: row.lease_token,
      p_error_code: errorCode,
      p_error_detail: errorDetail,
    },
  })
}

export async function enqueueStandalonePalEvent(input: {
  studentId: string
  sourceKind: string
  sourceId: string
  event: v1.V1Envelope
  supabase?: PalOutboxClient
}): Promise<'disabled' | 'enqueued'> {
  if (!isPalEnabled()) return 'disabled'

  const validation = v1.validateV1Event(input.event)
  if (!validation.ok) {
    throw new Error(`Cannot enqueue invalid Pal event: ${validation.error}`)
  }

  const supabase = input.supabase ?? getServiceRoleClient()
  const { error } = await supabase.rpc('enqueue_pal_event', {
    p_student_id: input.studentId,
    p_source_kind: input.sourceKind,
    p_source_id: input.sourceId,
    p_event: input.event,
  })

  if (error) {
    if (error.code === '42883' || error.code === 'PGRST202') {
      throw new Error('Pal outbox migration is required')
    }
    throw new Error(`Failed to enqueue Pal event: ${error.message ?? 'unknown error'}`)
  }

  return 'enqueued'
}

export async function deliverPalOutboxBatch(input: {
  supabase?: PalOutboxClient
  fetchImpl?: typeof fetch
  now?: Date
  limit?: number
  concurrency?: number
  deadlineAtMs?: number
  clock?: () => number
} = {}): Promise<PalOutboxDeliverySummary> {
  if (!isPalEnabled()) {
    return {
      status: 'disabled',
      claimed: 0,
      delivered: 0,
      retrying: 0,
      nonRetryable: 0,
    }
  }

  const { apiUrl, integrationSecret } = requirePalEnvironment()
  const supabase = input.supabase ?? getServiceRoleClient()
  const fetchImpl = input.fetchImpl ?? fetch
  const now = input.now ?? new Date()
  const clock = input.clock ?? Date.now
  const { data, error } = await supabase.rpc('claim_pal_event_outbox', {
    p_limit: input.limit ?? 10,
    p_lease_seconds: 60,
  })

  if (error) {
    if (error.code === '42883' || error.code === 'PGRST202') {
      throw new Error('Pal outbox migration is required')
    }
    throw new Error(`Failed to claim Pal outbox rows: ${error.message ?? 'unknown error'}`)
  }

  const rows = z.array(claimedOutboxRowSchema).parse(data ?? [])
  const summary: PalOutboxDeliverySummary = {
    status: 'ok',
    claimed: rows.length,
    delivered: 0,
    retrying: 0,
    nonRetryable: 0,
  }

  let nextRow = 0
  const deliverNext = async (): Promise<void> => {
    const rowIndex = nextRow
    nextRow += 1
    if (rowIndex >= rows.length) return
    const row = rows[rowIndex]

    const validation = v1.validateV1Event(row.payload)
    if (!validation.ok) {
      await markNonRetryable(
        supabase,
        row,
        validation.error,
        'Pika outbox payload failed the pinned Pal v1 validator',
      )
      summary.nonRetryable += 1
      return deliverNext()
    }

    const remainingMs = input.deadlineAtMs === undefined
      ? 3_000
      : input.deadlineAtMs - clock()
    if (remainingMs <= 0) {
      await markRetry(
        supabase,
        row,
        now,
        'worker_deadline',
        'Pal delivery worker reached its bounded execution deadline',
      )
      summary.retrying += 1
      return deliverNext()
    }

    let response: Response
    try {
      response = await fetchImpl(`${apiUrl}/api/v1/events`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${integrationSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validation.event),
        signal: AbortSignal.timeout(Math.max(1, Math.min(3_000, remainingMs))),
      })
    } catch {
      await markRetry(
        supabase,
        row,
        now,
        'network_error',
        'Pal delivery failed before an HTTP response was received',
      )
      summary.retrying += 1
      return deliverNext()
    }

    if (response.ok) {
      await transition(supabase, {
        functionName: 'complete_pal_event_outbox',
        args: {
          p_outbox_id: row.id,
          p_lease_token: row.lease_token,
        },
      })
      summary.delivered += 1
      return deliverNext()
    }

    const errorCode = `http_${response.status}`
    const errorDetail = `Pal returned HTTP ${response.status}`
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      await markRetry(supabase, row, now, errorCode, errorDetail)
      summary.retrying += 1
    } else {
      await markNonRetryable(supabase, row, errorCode, errorDetail)
      summary.nonRetryable += 1
    }
    return deliverNext()
  }

  const concurrency = Math.max(
    1,
    Math.min(input.concurrency ?? 10, rows.length || 1),
  )
  await Promise.all(Array.from({ length: concurrency }, () => deliverNext()))

  return summary
}

export async function drainPalOutbox(input: {
  supabase?: PalOutboxClient
  fetchImpl?: typeof fetch
  now?: Date
  batchSize?: number
  maxBatches?: number
  maxDurationMs?: number
  clock?: () => number
} = {}): Promise<PalOutboxDrainSummary> {
  const batchSize = input.batchSize ?? 20
  const maxBatches = input.maxBatches ?? 10
  const maxDurationMs = input.maxDurationMs ?? 8_000
  const clock = input.clock ?? Date.now
  const startedAt = clock()
  const deliveryDeadlineAt = startedAt + Math.max(1_000, maxDurationMs - 1_000)
  const summary: PalOutboxDrainSummary = {
    status: 'ok',
    claimed: 0,
    delivered: 0,
    retrying: 0,
    nonRetryable: 0,
    batches: 0,
    remainingReady: 0,
    stoppedReason: 'empty',
  }

  for (let batch = 0; batch < maxBatches; batch += 1) {
    if (batch > 0 && clock() >= deliveryDeadlineAt) {
      summary.stoppedReason = 'time_limit'
      break
    }

    const delivered = await deliverPalOutboxBatch({
      supabase: input.supabase,
      fetchImpl: input.fetchImpl,
      now: input.now,
      limit: batchSize,
      concurrency: 10,
      deadlineAtMs: deliveryDeadlineAt,
      clock,
    })
    if (delivered.status === 'disabled') {
      return { ...summary, status: 'disabled', stoppedReason: 'disabled' }
    }

    summary.batches += 1
    summary.claimed += delivered.claimed
    summary.delivered += delivered.delivered
    summary.retrying += delivered.retrying
    summary.nonRetryable += delivered.nonRetryable

    if (delivered.claimed === 0) {
      summary.stoppedReason = summary.claimed === 0 ? 'empty' : 'drained'
      break
    }
    if (clock() >= deliveryDeadlineAt) {
      summary.stoppedReason = 'time_limit'
      break
    }
    if (delivered.claimed < batchSize) {
      summary.stoppedReason = 'drained'
      break
    }
    summary.stoppedReason = batch + 1 === maxBatches
      ? 'batch_limit'
      : summary.stoppedReason
  }

  const supabase = input.supabase ?? getServiceRoleClient()
  const { data, error } = await supabase.rpc('count_pal_event_outbox_ready')
  if (error) {
    throw new Error(`Failed to count ready Pal outbox rows: ${error.message ?? 'unknown error'}`)
  }
  summary.remainingReady = z.number().int().nonnegative().parse(data)
  return summary
}

import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import { getServiceRoleClient } from '@/lib/supabase'
import { isPalEnabled, requirePalEnvironment } from '@/lib/server/pal-config'
import { v1 } from '@/vendor/pal-contract'

export type PalOutboxClient = Pick<
  ReturnType<typeof getServiceRoleClient>,
  'rpc'
>

export type PalImmediateDeliveryClient = Pick<
  ReturnType<typeof getServiceRoleClient>,
  'from' | 'rpc'
>

const claimedOutboxRowSchema = z.object({
  id: z.string().uuid(),
  payload: z.unknown(),
  attempts: z.number().int().positive(),
  lease_token: z.string().uuid(),
}).passthrough()

const immediateOutboxRowSchema = z.object({
  id: z.string().uuid(),
  payload: z.unknown(),
  status: z.enum(['pending', 'processing', 'delivered', 'non_retryable']),
  attempts: z.number().int().nonnegative(),
  next_attempt_at: z.string(),
  lease_expires_at: z.string().nullable(),
}).passthrough()

export type PalImmediateDeliveryStatus =
  | 'disabled'
  | 'delivered'
  | 'already_delivered'
  | 'pending'
  | 'non_retryable'

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

function emitPalTelemetry(
  label: '[pal-delivery]' | '[pal-outbox-drain]',
  fields: Record<string, unknown>,
): void {
  console.info(label, JSON.stringify(fields))
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
  signal?: AbortSignal,
): Promise<void> {
  let result: { data: boolean | null; error: { message?: string } | null }
  switch (transition.functionName) {
    case 'complete_pal_event_outbox':
      result = await withAbortSignal(
        supabase.rpc(transition.functionName, transition.args),
        signal,
      )
      break
    case 'retry_pal_event_outbox':
      result = await withAbortSignal(
        supabase.rpc(transition.functionName, transition.args),
        signal,
      )
      break
    case 'fail_pal_event_outbox':
      result = await withAbortSignal(
        supabase.rpc(transition.functionName, transition.args),
        signal,
      )
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

function withAbortSignal<T>(
  request: PromiseLike<T>,
  signal?: AbortSignal,
): PromiseLike<T> {
  const abortable = request as PromiseLike<T> & {
    abortSignal?: (requestSignal: AbortSignal) => PromiseLike<T>
  }
  return signal && typeof abortable.abortSignal === 'function'
    ? abortable.abortSignal(signal)
    : request
}

async function markRetry(
  supabase: PalOutboxClient,
  row: z.infer<typeof claimedOutboxRowSchema>,
  now: Date,
  errorCode: string,
  errorDetail: string,
  signal?: AbortSignal,
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
  }, signal)
}

async function markNonRetryable(
  supabase: PalOutboxClient,
  row: z.infer<typeof claimedOutboxRowSchema>,
  errorCode: string,
  errorDetail: string,
  signal?: AbortSignal,
): Promise<void> {
  await transition(supabase, {
    functionName: 'fail_pal_event_outbox',
    args: {
      p_outbox_id: row.id,
      p_lease_token: row.lease_token,
      p_error_code: errorCode,
      p_error_detail: errorDetail,
    },
  }, signal)
}

type ClaimedDeliveryResult = 'delivered' | 'retrying' | 'non_retryable'

async function deliverClaimedPalOutboxRow(input: {
  supabase: PalOutboxClient
  row: z.infer<typeof claimedOutboxRowSchema>
  apiUrl: string
  integrationSecret: string
  fetchImpl: typeof fetch
  now: Date
  deadlineAtMs?: number
  clock: () => number
  signal?: AbortSignal
  transitionSignal?: AbortSignal
}): Promise<ClaimedDeliveryResult> {
  const validation = v1.validateV1Event(input.row.payload)
  if (!validation.ok) {
    await markNonRetryable(
      input.supabase,
      input.row,
      validation.error,
      'Pika outbox payload failed the pinned Pal v1 validator',
      input.transitionSignal,
    )
    return 'non_retryable'
  }

  const remainingMs = input.deadlineAtMs === undefined
    ? 3_000
    : input.deadlineAtMs - input.clock()
  if (remainingMs <= 0) {
    await markRetry(
      input.supabase,
      input.row,
      input.now,
      'worker_deadline',
      'Pal delivery worker reached its bounded execution deadline',
      input.transitionSignal,
    )
    return 'retrying'
  }

  let response: Response
  try {
    response = await input.fetchImpl(`${input.apiUrl}/api/v1/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.integrationSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(validation.event),
      signal: input.signal
        ?? AbortSignal.timeout(Math.max(1, Math.min(3_000, remainingMs))),
    })
  } catch {
    await markRetry(
      input.supabase,
      input.row,
      input.now,
      'network_error',
      'Pal delivery failed before an HTTP response was received',
      input.transitionSignal,
    )
    return 'retrying'
  }

  if (response.ok) {
    await transition(input.supabase, {
      functionName: 'complete_pal_event_outbox',
      args: {
        p_outbox_id: input.row.id,
        p_lease_token: input.row.lease_token,
      },
    }, input.transitionSignal)
    return 'delivered'
  }

  const errorCode = `http_${response.status}`
  const errorDetail = `Pal returned HTTP ${response.status}`
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    await markRetry(
      input.supabase,
      input.row,
      input.now,
      errorCode,
      errorDetail,
      input.transitionSignal,
    )
    return 'retrying'
  }

  await markNonRetryable(
    input.supabase,
    input.row,
    errorCode,
    errorDetail,
    input.transitionSignal,
  )
  return 'non_retryable'
}

async function findImmediateOutboxRow(
  supabase: PalImmediateDeliveryClient,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<z.infer<typeof immediateOutboxRowSchema> | null> {
  const request = supabase
    .from('pal_event_outbox')
    .select('id, payload, status, attempts, next_attempt_at, lease_expires_at')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  const { data, error } = await withAbortSignal(request, signal)

  if (error) {
    throw new Error(`Failed to find immediate Pal outbox row: ${error.message ?? 'unknown error'}`)
  }
  return data === null ? null : immediateOutboxRowSchema.parse(data)
}

async function claimImmediateOutboxRow(input: {
  supabase: PalImmediateDeliveryClient
  row: z.infer<typeof immediateOutboxRowSchema>
  now: Date
  signal?: AbortSignal
}): Promise<z.infer<typeof claimedOutboxRowSchema> | null> {
  const pendingReady = input.row.status === 'pending'
    && new Date(input.row.next_attempt_at).getTime() <= input.now.getTime()
  const expiredProcessing = input.row.status === 'processing'
    && input.row.lease_expires_at !== null
    && new Date(input.row.lease_expires_at).getTime() <= input.now.getTime()
  if (!pendingReady && !expiredProcessing) return null

  const leaseToken = randomUUID()
  let request = input.supabase
    .from('pal_event_outbox')
    .update({
      status: 'processing',
      attempts: input.row.attempts + 1,
      lease_token: leaseToken,
      lease_expires_at: new Date(input.now.getTime() + 60_000).toISOString(),
      last_attempt_at: input.now.toISOString(),
      updated_at: input.now.toISOString(),
    })
    .eq('id', input.row.id)
    .eq('status', input.row.status)
    .eq('attempts', input.row.attempts)
  request = input.row.status === 'pending'
    ? request.lte('next_attempt_at', input.now.toISOString())
    : request.lte('lease_expires_at', input.now.toISOString())
  const claim = request
    .select('id, payload, attempts, lease_token')
    .maybeSingle()
  const { data, error } = await withAbortSignal(claim, input.signal)

  if (error) {
    throw new Error(`Failed to claim immediate Pal outbox row: ${error.message ?? 'unknown error'}`)
  }
  return data === null ? null : claimedOutboxRowSchema.parse(data)
}

/**
 * Best-effort delivery for the event committed by the current Pika action.
 * The source transaction has already succeeded, so every adapter failure is
 * converted to `pending` and left for the durable outbox recovery worker.
 */
async function attemptImmediatePalEventDeliveryWithinDeadline(input: {
  event: v1.V1Envelope
  supabase: PalImmediateDeliveryClient
  fetchImpl: typeof fetch
  now: Date
  deadlineAtMs: number
  clock: () => number
  signal: AbortSignal
  transitionSignal: AbortSignal
}): Promise<PalImmediateDeliveryStatus> {
  try {
    const { apiUrl, integrationSecret } = requirePalEnvironment()
    const row = await findImmediateOutboxRow(
      input.supabase,
      input.event.idempotency_key,
      input.signal,
    )

    if (row === null) return 'pending'
    if (row.status === 'delivered') return 'already_delivered'
    if (row.status === 'non_retryable') return 'non_retryable'

    const claimed = await claimImmediateOutboxRow({
      supabase: input.supabase,
      row,
      now: input.now,
      signal: input.signal,
    })
    if (claimed === null) {
      const latest = await findImmediateOutboxRow(
        input.supabase,
        input.event.idempotency_key,
        input.signal,
      )
      if (latest?.status === 'delivered') return 'already_delivered'
      if (latest?.status === 'non_retryable') return 'non_retryable'
      return 'pending'
    }

    const result = await deliverClaimedPalOutboxRow({
      supabase: input.supabase,
      row: claimed,
      apiUrl,
      integrationSecret,
      fetchImpl: input.fetchImpl,
      now: input.now,
      deadlineAtMs: input.deadlineAtMs,
      clock: input.clock,
      signal: input.signal,
      transitionSignal: input.transitionSignal,
    })
    if (result === 'delivered') return 'delivered'
    if (result === 'non_retryable') return 'non_retryable'
    return 'pending'
  } catch (error) {
    console.error('Immediate Pal delivery failed; event remains queued:', error)
    return 'pending'
  }
}

export async function attemptImmediatePalEventDelivery(input: {
  event: v1.V1Envelope
  supabase?: PalImmediateDeliveryClient
  fetchImpl?: typeof fetch
  now?: Date
  timeoutMs?: number
  clock?: () => number
}): Promise<PalImmediateDeliveryStatus> {
  if (!isPalEnabled()) return 'disabled'

  const timeoutMs = Math.max(1, input.timeoutMs ?? 2_000)
  const clock = input.clock ?? Date.now
  const startedAt = clock()
  const cleanupBudgetMs = Math.min(500, Math.max(1, Math.floor(timeoutMs / 4)))
  const signal = AbortSignal.timeout(Math.max(1, timeoutMs - cleanupBudgetMs))
  const transitionSignal = AbortSignal.timeout(timeoutMs)
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<PalImmediateDeliveryStatus>((resolve) => {
    timeoutId = setTimeout(() => resolve('pending'), timeoutMs)
  })

  let result: PalImmediateDeliveryStatus
  try {
    result = await Promise.race([
      attemptImmediatePalEventDeliveryWithinDeadline({
        event: input.event,
        supabase: input.supabase ?? getServiceRoleClient(),
        fetchImpl: input.fetchImpl ?? fetch,
        now: input.now ?? new Date(),
        deadlineAtMs: clock() + timeoutMs,
        clock,
        signal,
        transitionSignal,
      }),
      timeout,
    ])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }

  emitPalTelemetry('[pal-delivery]', {
    mode: 'immediate',
    event_type: input.event.event_type,
    outcome: result,
    duration_ms: Math.max(0, Math.round(clock() - startedAt)),
  })
  return result
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
  signal?: AbortSignal
  transitionSignal?: AbortSignal
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
  const { data, error } = await withAbortSignal(
    supabase.rpc('claim_pal_event_outbox', {
      p_limit: input.limit ?? 10,
      p_lease_seconds: 60,
    }),
    input.signal,
  )

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

    const result = await deliverClaimedPalOutboxRow({
      supabase,
      row,
      apiUrl,
      integrationSecret,
      fetchImpl,
      now,
      deadlineAtMs: input.deadlineAtMs,
      clock,
      signal: input.signal,
      transitionSignal: input.transitionSignal,
    })
    if (result === 'delivered') summary.delivered += 1
    else if (result === 'retrying') summary.retrying += 1
    else summary.nonRetryable += 1
    return deliverNext()
  }

  const concurrency = Math.max(
    1,
    Math.min(input.concurrency ?? 10, rows.length || 1),
  )
  await Promise.all(Array.from({ length: concurrency }, () => deliverNext()))

  return summary
}

type DrainPalOutboxInput = {
  supabase?: PalOutboxClient
  fetchImpl?: typeof fetch
  now?: Date
  batchSize?: number
  maxBatches?: number
  maxDurationMs?: number
  clock?: () => number
}

function categorizePalOutboxDrainError(error: unknown):
  | 'configuration'
  | 'claim'
  | 'count'
  | 'transition'
  | 'contract'
  | 'deadline'
  | 'unexpected' {
  if (error instanceof z.ZodError) return 'contract'
  if (!(error instanceof Error)) return 'unexpected'
  if (
    error.name === 'AbortError'
    || error.name === 'TimeoutError'
    || error.message.includes('bounded execution deadline')
  ) {
    return 'deadline'
  }
  if (error.message.includes('PAL_') || error.message.includes('Pal configuration')) {
    return 'configuration'
  }
  if (error.message.includes('claim Pal outbox')) return 'claim'
  if (error.message.includes('count ready Pal outbox')) return 'count'
  if (
    error.message.includes('transition Pal outbox')
    || error.message.includes('Pal outbox lease was lost')
  ) {
    return 'transition'
  }
  return 'unexpected'
}

async function drainPalOutboxWithinDeadline(
  input: DrainPalOutboxInput,
): Promise<PalOutboxDrainSummary> {
  const batchSize = input.batchSize ?? 20
  const maxBatches = input.maxBatches ?? 10
  const maxDurationMs = input.maxDurationMs ?? 8_000
  const clock = input.clock ?? Date.now
  const startedAt = clock()
  const cleanupBudgetMs = Math.min(1_000, Math.max(1, Math.floor(maxDurationMs / 4)))
  const deliveryBudgetMs = Math.max(1, maxDurationMs - cleanupBudgetMs)
  const deliveryDeadlineAt = startedAt + deliveryBudgetMs
  const deliverySignal = AbortSignal.timeout(deliveryBudgetMs)
  const transitionSignal = AbortSignal.timeout(Math.max(1, maxDurationMs))
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
      signal: deliverySignal,
      transitionSignal,
    })
    if (delivered.status === 'disabled') {
      return {
        ...summary,
        status: 'disabled',
        stoppedReason: 'disabled',
      }
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
  const { data, error } = await withAbortSignal(
    supabase.rpc('count_pal_event_outbox_ready'),
    transitionSignal,
  )
  if (error) {
    throw new Error(`Failed to count ready Pal outbox rows: ${error.message ?? 'unknown error'}`)
  }
  summary.remainingReady = z.number().int().nonnegative().parse(data)
  return summary
}

export async function drainPalOutbox(
  input: DrainPalOutboxInput = {},
): Promise<PalOutboxDrainSummary> {
  const clock = input.clock ?? Date.now
  const startedAt = clock()
  const maxDurationMs = Math.max(1, input.maxDurationMs ?? 8_000)
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Pal outbox drain exceeded its bounded execution deadline'))
    }, maxDurationMs)
  })

  try {
    const summary = await Promise.race([
      drainPalOutboxWithinDeadline({ ...input, maxDurationMs }),
      timeout,
    ])
    emitPalTelemetry('[pal-outbox-drain]', {
      status: summary.status,
      claimed: summary.claimed,
      delivered: summary.delivered,
      retrying: summary.retrying,
      non_retryable: summary.nonRetryable,
      remaining_ready: summary.remainingReady,
      stopped_reason: summary.stoppedReason,
      duration_ms: Math.max(0, Math.round(clock() - startedAt)),
    })
    return summary
  } catch (error) {
    emitPalTelemetry('[pal-outbox-drain]', {
      status: 'error',
      error_category: categorizePalOutboxDrainError(error),
      duration_ms: Math.max(0, Math.round(clock() - startedAt)),
    })
    throw error
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

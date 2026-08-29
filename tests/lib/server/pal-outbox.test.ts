import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildDailyLogWeekConfiguredEvent,
  buildSessionStartedEvent,
} from '@/lib/server/pal-events'
import {
  attemptImmediatePalEventDelivery,
  deliverPalOutboxBatch,
  drainPalOutbox,
  enqueueStandalonePalEvent,
} from '@/lib/server/pal-outbox'

const studentId = '10000000-0000-4000-8000-000000000001'
const rowId = '20000000-0000-4000-8000-000000000001'
const leaseToken = '30000000-0000-4000-8000-000000000001'
const occurredAt = new Date('2026-09-16T18:20:00.000Z')
const event = buildSessionStartedEvent({
  learnerId: studentId,
  sessionId: 'session-1',
  occurredAt,
  pseudonymSecret: 'test-pseudonym-secret-32-characters-long',
})
const weeklyEvent = buildDailyLogWeekConfiguredEvent({
  learnerId: studentId,
  occurredAt,
  periodKey: 'pika-week-2026-09-14',
  configVersion: 1,
  periodStatus: 'open',
  eligibleDays: 3,
  pseudonymSecret: 'test-pseudonym-secret-32-characters-long',
  termCalendar: {
    termIdentity: 'pika-term:2026-08-31:2027-01-31:America/Toronto',
    termStartDay: '2026-08-31',
    termEndDay: '2027-01-31',
    termTimezone: 'America/Toronto',
    termWeekCount: 22,
    weekStartDay: '2026-09-14',
    weekIndex: 3,
  },
})

function buildSupabase(rows: unknown[] = []) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args })
    if (name === 'claim_pal_event_outbox') {
      return { data: rows, error: null }
    }
    return { data: true, error: null }
  })
  return { client: { rpc }, calls }
}

function buildImmediateSupabase(input: {
  lookups: unknown[]
  claimed?: unknown
}) {
  const lookupResults = [...input.lookups]
  const claimFilters: Array<{
    method: 'eq' | 'lte'
    column: string
    value: unknown
  }> = []
  const update = vi.fn((values: Record<string, unknown>) => {
    const claimBuilder: any = {
      eq: vi.fn((column: string, value: unknown) => {
        claimFilters.push({ method: 'eq', column, value })
        return claimBuilder
      }),
      lte: vi.fn((column: string, value: unknown) => {
        claimFilters.push({ method: 'lte', column, value })
        return claimBuilder
      }),
      select: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({ data: input.claimed ?? null, error: null })),
      })),
    }
    return claimBuilder
  })
  const select = vi.fn(() => {
    const lookupBuilder: any = {
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({
          data: lookupResults.shift() ?? null,
          error: null,
        })),
      })),
    }
    return lookupBuilder
  })
  const batch = buildSupabase()
  return {
    client: {
      rpc: batch.client.rpc,
      from: vi.fn(() => ({ select, update })),
    },
    calls: batch.calls,
    claimFilters,
    update,
  }
}

function immediateRow(
  status: 'pending' | 'processing' | 'delivered' | 'non_retryable' = 'pending',
  leaseExpiresAt: string | null = status === 'processing'
    ? '2026-09-16T18:21:00.000Z'
    : null,
) {
  return {
    id: rowId,
    payload: event,
    status,
    attempts: 0,
    next_attempt_at: '2026-09-16T18:19:00.000Z',
    lease_expires_at: leaseExpiresAt,
  }
}

function claimedRow(payload: unknown = event, attempts = 1) {
  return {
    id: rowId,
    payload,
    attempts,
    lease_token: leaseToken,
  }
}

describe('Pal outbox adapter', () => {
  beforeEach(() => {
    vi.stubEnv('PAL_ENABLED', 'true')
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test/')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'pal-integration-secret-32-characters')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'test-pseudonym-secret-32-characters-long')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not touch the outbox while the pilot flag is disabled', async () => {
    vi.stubEnv('PAL_ENABLED', 'false')
    const supabase = buildSupabase()

    await expect(enqueueStandalonePalEvent({
      studentId,
      sourceKind: 'session',
      sourceId: 'session-1',
      event,
      supabase: supabase.client,
    })).resolves.toBe('disabled')
    await expect(deliverPalOutboxBatch({
      supabase: supabase.client,
    })).resolves.toMatchObject({ status: 'disabled', claimed: 0 })
    expect(supabase.client.rpc).not.toHaveBeenCalled()
  })

  it('enqueues a validated standalone session fact', async () => {
    const supabase = buildSupabase()

    await expect(enqueueStandalonePalEvent({
      studentId,
      sourceKind: 'authenticated_session',
      sourceId: 'session-1',
      event,
      supabase: supabase.client,
    })).resolves.toBe('enqueued')

    expect(supabase.calls).toEqual([{
      name: 'enqueue_pal_event',
      args: expect.objectContaining({
        p_student_id: studentId,
        p_event: event,
      }),
    }])
  })

  it('delivers a claimed fact with bearer authentication and completes its lease', async () => {
    const supabase = buildSupabase([claimedRow()])
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ status: 'processed' }), { status: 200 }))

    await expect(deliverPalOutboxBatch({
      supabase: supabase.client,
      fetchImpl,
      now: occurredAt,
    })).resolves.toMatchObject({
      claimed: 1,
      delivered: 1,
      retrying: 0,
      nonRetryable: 0,
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://pal.example.test/api/v1/events',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer pal-integration-secret-32-characters',
        }),
        body: JSON.stringify(event),
      }),
    )
    expect(supabase.calls.at(-1)).toEqual({
      name: 'complete_pal_event_outbox',
      args: {
        p_outbox_id: rowId,
        p_lease_token: leaseToken,
      },
    })
  })

  it('delivers the adaptive weekly calendar unchanged from the durable outbox', async () => {
    const supabase = buildSupabase([claimedRow(weeklyEvent)])
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }))

    await expect(deliverPalOutboxBatch({
      supabase: supabase.client,
      fetchImpl,
      now: occurredAt,
    })).resolves.toMatchObject({ delivered: 1, nonRetryable: 0 })

    const request = fetchImpl.mock.calls[0]?.[1]
    expect(JSON.parse(String(request?.body))).toEqual(weeklyEvent)
    expect(String(request?.body)).not.toContain(studentId)
    expect(weeklyEvent.metadata).toEqual(expect.objectContaining({
      term_token: expect.stringMatching(/^pika-term-/),
      term_week_count: 22,
      week_index: 3,
    }))
  })

  it('claims and delivers only the outbox fact committed by the current action', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const supabase = buildImmediateSupabase({
      lookups: [immediateRow()],
      claimed: claimedRow(),
    })
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }))

    await expect(attemptImmediatePalEventDelivery({
      event,
      supabase: supabase.client,
      fetchImpl,
      now: occurredAt,
    })).resolves.toBe('delivered')

    expect(supabase.client.from).toHaveBeenCalledWith('pal_event_outbox')
    expect(supabase.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'processing',
      attempts: 1,
    }))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(supabase.calls.at(-1)).toEqual({
      name: 'complete_pal_event_outbox',
      args: {
        p_outbox_id: rowId,
        p_lease_token: leaseToken,
      },
    })
    expect(info.mock.calls.at(-1)?.[0]).toBe('[pal-delivery]')
    expect(JSON.parse(String(info.mock.calls.at(-1)?.[1]))).toMatchObject({
      mode: 'immediate',
      event_type: 'platform.session.started',
      outcome: 'delivered',
      duration_ms: expect.any(Number),
    })
  })

  it('does not redeliver an idempotent action whose fact is already delivered', async () => {
    const supabase = buildImmediateSupabase({ lookups: [immediateRow('delivered')] })
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(attemptImmediatePalEventDelivery({
      event,
      supabase: supabase.client,
      fetchImpl,
      now: occurredAt,
    })).resolves.toBe('already_delivered')

    expect(supabase.update).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('leaves an immediate network failure queued for durable retry', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const supabase = buildImmediateSupabase({
      lookups: [immediateRow()],
      claimed: claimedRow(),
    })
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('network unavailable')
    })

    await expect(attemptImmediatePalEventDelivery({
      event,
      supabase: supabase.client,
      fetchImpl,
      now: occurredAt,
    })).resolves.toBe('pending')

    expect(supabase.calls.at(-1)).toMatchObject({
      name: 'retry_pal_event_outbox',
      args: { p_error_code: 'network_error' },
    })
    expect(JSON.parse(String(info.mock.calls.at(-1)?.[1]))).toMatchObject({
      mode: 'immediate',
      event_type: 'platform.session.started',
      outcome: 'pending',
    })
  })

  it('backs off when another worker wins the targeted claim', async () => {
    const supabase = buildImmediateSupabase({
      lookups: [immediateRow(), immediateRow('processing')],
      claimed: null,
    })
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(attemptImmediatePalEventDelivery({
      event,
      supabase: supabase.client,
      fetchImpl,
      now: occurredAt,
    })).resolves.toBe('pending')

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('atomically reclaims an expired immediate lease on a later action', async () => {
    const supabase = buildImmediateSupabase({
      lookups: [immediateRow('processing', '2026-09-16T18:19:00.000Z')],
      claimed: claimedRow(),
    })
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }))

    await expect(attemptImmediatePalEventDelivery({
      event,
      supabase: supabase.client,
      fetchImpl,
      now: occurredAt,
    })).resolves.toBe('delivered')

    expect(supabase.claimFilters).toContainEqual({
      method: 'eq',
      column: 'status',
      value: 'processing',
    })
    expect(supabase.claimFilters).toContainEqual({
      method: 'lte',
      column: 'lease_expires_at',
      value: occurredAt.toISOString(),
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('returns within its bound when a delivery transition never resolves', async () => {
    const supabase = buildImmediateSupabase({
      lookups: [immediateRow()],
      claimed: claimedRow(),
    })
    supabase.client.rpc = vi.fn((name: string) => {
      if (name === 'complete_pal_event_outbox') {
        return new Promise<never>(() => undefined)
      }
      return Promise.resolve({ data: true, error: null })
    })
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }))
    const startedAt = performance.now()

    await expect(attemptImmediatePalEventDelivery({
      event,
      supabase: supabase.client,
      fetchImpl,
      now: occurredAt,
      // Leave enough scheduler headroom for the fetch to begin when the full
      // Vitest pool is busy; the unresolved transition is still tightly bounded.
      timeoutMs: 100,
    })).resolves.toBe('pending')

    expect(performance.now() - startedAt).toBeLessThan(500)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('bounds a batch drain when a delivery transition never resolves', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const rpc = vi.fn((name: string) => {
      if (name === 'claim_pal_event_outbox') {
        return Promise.resolve({ data: [claimedRow()], error: null })
      }
      if (name === 'complete_pal_event_outbox') {
        return new Promise<never>(() => undefined)
      }
      return Promise.resolve({ data: 0, error: null })
    })
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }))
    const startedAt = performance.now()

    await expect(drainPalOutbox({
      supabase: { rpc },
      fetchImpl,
      now: occurredAt,
      maxDurationMs: 20,
    })).rejects.toThrow('bounded execution deadline')

    expect(performance.now() - startedAt).toBeLessThan(250)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(info.mock.calls.at(-1)?.[1]))).toEqual({
      status: 'error',
      error_category: 'deadline',
      duration_ms: expect.any(Number),
    })
  })

  it('classifies a wrapped PostgREST claim timeout as a drain deadline', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const stalledRequest = Object.assign(new Promise<never>(() => undefined), {
      abortSignal: (signal: AbortSignal) => new Promise((resolve) => {
        const resolveTimeout = () => resolve({
          data: null,
          error: { message: 'TimeoutError: operation aborted by signal' },
        })
        if (signal.aborted) resolveTimeout()
        else signal.addEventListener('abort', resolveTimeout, { once: true })
      }),
    })
    const rpc = vi.fn(() => stalledRequest)
    const startedAt = performance.now()

    await expect(drainPalOutbox({
      supabase: { rpc } as any,
      maxDurationMs: 40,
    })).rejects.toThrow('Failed to claim Pal outbox rows')

    expect(performance.now() - startedAt).toBeLessThan(250)
    expect(JSON.parse(String(info.mock.calls.at(-1)?.[1]))).toEqual({
      status: 'error',
      error_category: 'deadline',
      duration_ms: expect.any(Number),
    })
  })

  it('uses the cleanup budget to record retry after the Pal request times out', async () => {
    const supabase = buildImmediateSupabase({
      lookups: [immediateRow()],
      claimed: claimedRow(),
    })
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal
      if (!signal) {
        reject(new Error('missing timeout signal'))
        return
      }
      signal.addEventListener('abort', () => reject(new Error('request timed out')), {
        once: true,
      })
    }))

    await expect(attemptImmediatePalEventDelivery({
      event,
      supabase: supabase.client,
      fetchImpl,
      now: occurredAt,
      timeoutMs: 40,
    })).resolves.toBe('pending')

    expect(supabase.calls.at(-1)).toMatchObject({
      name: 'retry_pal_event_outbox',
      args: { p_error_code: 'network_error' },
    })
  })

  it('retries network and server failures with bounded exponential delay', async () => {
    const supabase = buildSupabase([claimedRow(event, 3)])
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 503 }))

    await expect(deliverPalOutboxBatch({
      supabase: supabase.client,
      fetchImpl,
      now: occurredAt,
    })).resolves.toMatchObject({ retrying: 1 })

    expect(supabase.calls.at(-1)).toEqual({
      name: 'retry_pal_event_outbox',
      args: {
        p_outbox_id: rowId,
        p_lease_token: leaseToken,
        p_next_attempt_at: '2026-09-16T18:22:00.000Z',
        p_error_code: 'http_503',
        p_error_detail: 'Pal returned HTTP 503',
      },
    })
  })

  it('quarantines contract-invalid payloads without contacting Pal', async () => {
    const supabase = buildSupabase([claimedRow({ ...event, schema_version: 2 })])
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(deliverPalOutboxBatch({
      supabase: supabase.client,
      fetchImpl,
      now: occurredAt,
    })).resolves.toMatchObject({ nonRetryable: 1 })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(supabase.calls.at(-1)).toEqual({
      name: 'fail_pal_event_outbox',
      args: {
        p_outbox_id: rowId,
        p_lease_token: leaseToken,
        p_error_code: 'unsupported_schema_version',
        p_error_detail: 'Pika outbox payload failed the pinned Pal v1 validator',
      },
    })
  })

  it('quarantines envelope privacy violations without contacting Pal', async () => {
    const supabase = buildSupabase([claimedRow({
      ...event,
      email: 'learner@example.com',
    })])
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(deliverPalOutboxBatch({
      supabase: supabase.client,
      fetchImpl,
      now: occurredAt,
    })).resolves.toMatchObject({ nonRetryable: 1 })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(supabase.calls.at(-1)).toMatchObject({
      name: 'fail_pal_event_outbox',
      args: { p_error_code: 'invalid_envelope' },
    })
  })

  it('quarantines permanent HTTP failures for operator reconciliation', async () => {
    const supabase = buildSupabase([claimedRow()])
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 422 }))

    await expect(deliverPalOutboxBatch({
      supabase: supabase.client,
      fetchImpl,
      now: occurredAt,
    })).resolves.toMatchObject({ nonRetryable: 1 })

    expect(supabase.calls.at(-1)).toMatchObject({
      name: 'fail_pal_event_outbox',
      args: {
        p_error_code: 'http_422',
        p_error_detail: 'Pal returned HTTP 422',
      },
    })
  })

  it('releases a claimed row without contacting Pal after the worker deadline', async () => {
    const supabase = buildSupabase([claimedRow()])
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(deliverPalOutboxBatch({
      supabase: supabase.client,
      fetchImpl,
      now: occurredAt,
      deadlineAtMs: 1_000,
      clock: () => 1_000,
    })).resolves.toMatchObject({ retrying: 1 })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(supabase.calls.at(-1)).toMatchObject({
      name: 'retry_pal_event_outbox',
      args: { p_error_code: 'worker_deadline' },
    })
  })

  it('drains more than one class-day of events and reports no ready backlog', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const batchSizes = [20, 20, 20, 20, 20, 20, 0]
    let claim = 0
    const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
      if (name === 'claim_pal_event_outbox') {
        const count = batchSizes[claim++] ?? 0
        return {
          data: Array.from({ length: count }, (_, index) => ({
            id: `${String(claim).padStart(8, '0')}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
            payload: event,
            attempts: 1,
            lease_token: `${String(claim + 100).padStart(8, '0')}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          })),
          error: null,
        }
      }
      if (name === 'count_pal_event_outbox_ready') {
        return { data: 0, error: null }
      }
      return { data: true, error: null }
    })
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }))

    await expect(drainPalOutbox({
      supabase: { rpc },
      fetchImpl,
      now: occurredAt,
    })).resolves.toMatchObject({
      claimed: 120,
      delivered: 120,
      batches: 7,
      remainingReady: 0,
      stoppedReason: 'drained',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(120)
    expect(rpc).toHaveBeenCalledWith('count_pal_event_outbox_ready')
    expect(info.mock.calls.at(-1)?.[0]).toBe('[pal-outbox-drain]')
    expect(JSON.parse(String(info.mock.calls.at(-1)?.[1]))).toMatchObject({
      status: 'ok',
      claimed: 120,
      delivered: 120,
      retrying: 0,
      non_retryable: 0,
      remaining_ready: 0,
      stopped_reason: 'drained',
      duration_ms: expect.any(Number),
    })
  })

  it('emits sanitized drain telemetry when claiming fails', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: 'database unavailable' },
    }))

    await expect(drainPalOutbox({ supabase: { rpc } })).rejects.toThrow(
      'Failed to claim Pal outbox rows',
    )

    expect(info.mock.calls.at(-1)?.[0]).toBe('[pal-outbox-drain]')
    expect(JSON.parse(String(info.mock.calls.at(-1)?.[1]))).toEqual({
      status: 'error',
      error_category: 'claim',
      duration_ms: expect.any(Number),
    })
  })

  it('emits sanitized drain telemetry when Pal configuration is invalid', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.stubEnv('PAL_INTEGRATION_SECRET', '')

    await expect(drainPalOutbox()).rejects.toThrow('PAL_ENABLED requires')

    expect(JSON.parse(String(info.mock.calls.at(-1)?.[1]))).toEqual({
      status: 'error',
      error_category: 'configuration',
      duration_ms: expect.any(Number),
    })
  })

  it('emits sanitized drain telemetry when the final ready count fails', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const rpc = vi.fn(async (name: string) => name === 'claim_pal_event_outbox'
      ? { data: [], error: null }
      : { data: null, error: { message: 'count unavailable' } })

    await expect(drainPalOutbox({ supabase: { rpc } })).rejects.toThrow(
      'Failed to count ready Pal outbox rows',
    )

    expect(JSON.parse(String(info.mock.calls.at(-1)?.[1]))).toEqual({
      status: 'error',
      error_category: 'count',
      duration_ms: expect.any(Number),
    })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildSessionStartedEvent } from '@/lib/server/pal-events'
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
  const update = vi.fn((values: Record<string, unknown>) => {
    const claimBuilder: any = {
      eq: vi.fn(() => claimBuilder),
      lte: vi.fn(() => claimBuilder),
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
    update,
  }
}

function immediateRow(status: 'pending' | 'processing' | 'delivered' | 'non_retryable' = 'pending') {
  return {
    id: rowId,
    payload: event,
    status,
    attempts: 0,
    next_attempt_at: '2026-09-16T18:19:00.000Z',
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

  it('claims and delivers only the outbox fact committed by the current action', async () => {
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
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildSessionStartedEvent } from '@/lib/server/pal-events'
import {
  deliverPalOutboxBatch,
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
  pseudonymSecret: 'test-pseudonym-secret',
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
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'pal-secret')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'test-pseudonym-secret')
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
          Authorization: 'Bearer pal-secret',
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
})

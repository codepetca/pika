import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attemptMembershipPalActionDelivery, deliverPalOutboxBatch, enqueueStandalonePalEvent } from '@/lib/server/pal-outbox'

const event = {
  schema_version: 1 as const, idempotency_key: 'pika:membership:v1:test',
  learner_id: `pika-membership-v1-${'a'.repeat(32)}`, event_type: 'platform.session.started' as const,
  occurred_at: '2026-09-12T18:00:00Z', metadata: {},
}
const row = { id: 'c1690000-0000-4000-8000-000000000030', payload: event, attempts: 1,
  lease_token: 'c1690000-0000-4000-8000-000000000031' }

describe('membership Pal outbox delivery', () => {
  beforeEach(() => {
    vi.stubEnv('PAL_ENABLED', 'true')
    vi.stubEnv('PAL_CLASSROOM_ENABLED', 'true')
    vi.stubEnv('PAL_MEMBERSHIP_IDENTITY_ENABLED', 'true')
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-'.repeat(3))
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-'.repeat(3))
  })
  afterEach(() => vi.unstubAllEnvs())

  function client(statuses = ['active', 'active']) {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_pal_membership_outbox') return { data: [row], error: null }
      if (name === 'authorize_pal_membership_delivery') return { data: { status: statuses.shift() }, error: null }
      return { data: true, error: null }
    })
    return { rpc }
  }

  it('claims only fresh events, checks membership around HTTP and uses the existing lease transition', async () => {
    const supabase = client()
    const send = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    expect(await deliverPalOutboxBatch({ supabase: supabase as never, fetchImpl: send })).toMatchObject({ delivered: 1 })
    expect(supabase.rpc.mock.calls.map(([name]) => name)).toEqual([
      'claim_pal_membership_outbox', 'authorize_pal_membership_delivery',
      'authorize_pal_membership_delivery', 'complete_pal_event_outbox',
    ])
    expect(JSON.parse(send.mock.calls[0][1].body)).toEqual(event)
  })

  it('sends nothing after removal and terminates the old generation event', async () => {
    const supabase = client(['forbidden'])
    const send = vi.fn()
    expect(await deliverPalOutboxBatch({ supabase: supabase as never, fetchImpl: send })).toMatchObject({ nonRetryable: 1 })
    expect(send).not.toHaveBeenCalled()
  })

  it('retains events for bounded retry when the database gate is off', async () => {
    const supabase = client(['disabled'])
    const send = vi.fn()
    expect(await deliverPalOutboxBatch({ supabase: supabase as never, fetchImpl: send })).toMatchObject({ retrying: 1 })
    expect(send).not.toHaveBeenCalled()
  })

  it('does not record successful delivery when access changes during HTTP', async () => {
    const supabase = client(['active', 'forbidden'])
    const send = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    expect(await deliverPalOutboxBatch({ supabase: supabase as never, fetchImpl: send })).toMatchObject({ nonRetryable: 1 })
    expect(supabase.rpc.mock.calls.map(([name]) => name)).not.toContain('complete_pal_event_outbox')
  })

  it('keeps provider outages in the durable queue', async () => {
    const supabase = client()
    const send = vi.fn().mockRejectedValue(new Error('offline'))
    expect(await deliverPalOutboxBatch({ supabase: supabase as never, fetchImpl: send })).toMatchObject({ retrying: 1 })
  })

  it('never falls back to legacy claims when the foundation app gate is missing', async () => {
    vi.stubEnv('PAL_MEMBERSHIP_IDENTITY_ENABLED', 'false')
    const supabase = client()
    expect(await deliverPalOutboxBatch({ supabase: supabase as never })).toMatchObject({ status: 'disabled' })
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('suppresses standalone account/session producers in classroom mode', async () => {
    const supabase = client()
    expect(await enqueueStandalonePalEvent({ studentId: row.id, sourceKind: 'authenticated_session',
      sourceId: 'session', event, supabase: supabase as never })).toBe('disabled')
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('bounds post-commit delivery and claims only the current action membership', async () => {
    const supabase = client()
    const membership = { studentId: 'c1690000-0000-4000-8000-000000000002',
      classroomId: 'c1690000-0000-4000-8000-000000000010' }
    const send = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    expect(await attemptMembershipPalActionDelivery({ membership, supabase: supabase as never, fetchImpl: send })).toBe('delivered')
    expect(supabase.rpc).toHaveBeenCalledWith('claim_pal_membership_outbox', expect.objectContaining({
      p_student_id: membership.studentId, p_classroom_id: membership.classroomId,
    }))
    const stalled = { rpc: vi.fn(() => new Promise(() => undefined)) }
    expect(await attemptMembershipPalActionDelivery({ membership, supabase: stalled as never, timeoutMs: 10 })).toBe('pending')
  })
})

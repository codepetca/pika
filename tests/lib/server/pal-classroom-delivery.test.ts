import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attemptImmediatePalEventDelivery, attemptMembershipPalActionDelivery, deliverPalOutboxBatch, enqueueStandalonePalEvent } from '@/lib/server/pal-outbox'

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

  it.each(['false', 'true'])('routes a null legacy payload safely with identity gate %s', async identityEnabled => {
    vi.stubEnv('PAL_MEMBERSHIP_IDENTITY_ENABLED', identityEnabled)
    const supabase = client()
    const send = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    const result = await attemptImmediatePalEventDelivery({
      event: null, membership: { studentId: 'student', classroomId: 'classroom' },
      supabase: supabase as never, fetchImpl: send,
    })
    expect(result).toBe(identityEnabled === 'true' ? 'delivered' : 'disabled')
    expect(send).toHaveBeenCalledTimes(identityEnabled === 'true' ? 1 : 0)
    if (identityEnabled === 'false') expect(supabase.rpc).not.toHaveBeenCalled()
  })

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

  it('stops a queued event when SQL proves its subject is the same-class owner', async () => {
    // Labels never cross the delivery boundary: SQL derives current ownership
    // from the immutable private event binding, not a caller-provided role.
    const supabase = client(['owner'])
    const send = vi.fn()
    expect(await deliverPalOutboxBatch({ supabase: supabase as never, fetchImpl: send }))
      .toMatchObject({ delivered: 0, nonRetryable: 1, retrying: 0 })
    expect(send).not.toHaveBeenCalled()
    expect(supabase.rpc).toHaveBeenLastCalledWith('fail_pal_event_outbox', {
      p_outbox_id: row.id, p_lease_token: row.lease_token,
      p_error_code: 'membership_owner',
      p_error_detail: 'Classroom ownership transition stopped further learner event delivery',
    })
    expect(row.payload).toEqual(event)
  })

  it('records an already accepted attempt when ownership alone changes during HTTP', async () => {
    const supabase = client(['active', 'owner'])
    const send = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    expect(await deliverPalOutboxBatch({ supabase: supabase as never, fetchImpl: send }))
      .toMatchObject({ delivered: 1, nonRetryable: 0, retrying: 0 })
    expect(send).toHaveBeenCalledOnce()
    expect(supabase.rpc).toHaveBeenLastCalledWith('complete_pal_event_outbox', {
      p_outbox_id: row.id, p_lease_token: row.lease_token,
    })
    expect(JSON.parse(send.mock.calls[0][1].body)).toEqual(event)
  })

  it.each(['timeout', 408, 429, 500])('stops the next send after ownership changes following uncertain/retryable outcome %s', async outcome => {
    const supabase = client(['active', 'owner'])
    const send = outcome === 'timeout'
      ? vi.fn().mockRejectedValue(new Error('No acknowledgement'))
      : vi.fn().mockResolvedValue(new Response('{}', { status: outcome as number }))
    expect(await deliverPalOutboxBatch({ supabase: supabase as never, fetchImpl: send }))
      .toMatchObject({ delivered: 0, retrying: 1 })
    expect(supabase.rpc).toHaveBeenLastCalledWith('retry_pal_event_outbox', expect.objectContaining({
      p_outbox_id: row.id, p_lease_token: row.lease_token,
    }))
    expect(await deliverPalOutboxBatch({ supabase: supabase as never, fetchImpl: send }))
      .toMatchObject({ delivered: 0, retrying: 0, nonRetryable: 1 })
    expect(send).toHaveBeenCalledOnce()
    expect(supabase.rpc).toHaveBeenLastCalledWith('fail_pal_event_outbox', expect.objectContaining({
      p_error_code: 'membership_owner',
    }))
  })

  it.each([false, true])('does not treat malformed owner evidence as authority after acknowledgement=%s', async afterAcknowledgement => {
    const supabase = client()
    let authorizations = 0
    supabase.rpc.mockImplementation(async (name: string) => {
      if (name === 'claim_pal_membership_outbox') return { data: [row], error: null } as never
      if (name === 'authorize_pal_membership_delivery') {
        authorizations += 1
        return { data: afterAcknowledgement && authorizations === 1 ? { status: 'active' }
          : { status: 'owner', learner_id: event.learner_id }, error: null } as never
      }
      return { data: true, error: null } as never
    })
    const send = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    expect(await deliverPalOutboxBatch({ supabase: supabase as never, fetchImpl: send }))
      .toMatchObject({ retrying: 1, delivered: 0 })
    expect(send).toHaveBeenCalledTimes(afterAcknowledgement ? 1 : 0)
    expect(supabase.rpc.mock.calls.map(([name]) => name)).not.toContain('complete_pal_event_outbox')
  })

  it('never forces a successful receipt through a lost completion lease', async () => {
    const supabase = client(['active', 'owner'])
    const rpc = supabase.rpc.getMockImplementation()!
    supabase.rpc.mockImplementation(async name => name === 'complete_pal_event_outbox'
      ? { data: false, error: null } as never : rpc(name))
    const send = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    await expect(deliverPalOutboxBatch({ supabase: supabase as never, fetchImpl: send }))
      .rejects.toThrow('Pal outbox lease was lost')
    expect(send).toHaveBeenCalledOnce()
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

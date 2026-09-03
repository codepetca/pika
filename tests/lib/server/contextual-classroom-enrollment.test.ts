import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-handler'
import {
  buildClassroomJoinRateLimitKeys,
  joinClassroomByCodeAtomic,
  normalizeClassroomJoinCode,
} from '@/lib/server/contextual-classroom-enrollment'
import { v1 } from '@/vendor/pal-contract'

function createClient(result: { data: unknown; error: unknown }) {
  return { rpc: vi.fn().mockResolvedValue(result) }
}

describe('contextual classroom enrollment server adapter', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('normalizes invitation codes and derives actor-scoped opaque keys', () => {
    vi.stubEnv('SESSION_SECRET', 'session-secret-that-is-at-least-32-characters')
    const actorA = '11111111-1111-4111-8111-111111111111'
    const actorB = '22222222-2222-4222-8222-222222222222'

    expect(normalizeClassroomJoinCode(' abc-123 ')).toBe('ABC-123')
    const first = buildClassroomJoinRateLimitKeys(actorA, ' abc-123 ')
    const same = buildClassroomJoinRateLimitKeys(actorA, 'ABC-123')
    const otherActor = buildClassroomJoinRateLimitKeys(actorB, 'ABC-123')

    expect(first).toEqual(same)
    expect(first.actorKeyHash).toMatch(/^[0-9a-f]{64}$/)
    expect(first.invitationKeyHash).toMatch(/^[0-9a-f]{64}$/)
    expect(first.invitationKeyHash).not.toBe(otherActor.invitationKeyHash)
    expect(JSON.stringify(first)).not.toContain('ABC-123')
  })

  it('calls the service-only RPC with derived keys and validates the result', async () => {
    vi.stubEnv('SESSION_SECRET', 'session-secret-that-is-at-least-32-characters')
    const client = createClient({
      data: {
        ok: true,
        status: 201,
        created: true,
        already_enrolled: false,
        classroom: { id: '33333333-3333-4333-8333-333333333333', title: 'Biology', term_label: null },
        enrollment: { id: '44444444-4444-4444-8444-444444444444', created_at: '2026-09-03T12:00:00.000Z' },
      },
      error: null,
    })

    const result = await joinClassroomByCodeAtomic({
      actorId: '11111111-1111-4111-8111-111111111111',
      expectedClassroomId: '33333333-3333-4333-8333-333333333333',
      classCode: ' bio-101 ',
      firstName: 'Ada',
      lastName: 'Lovelace',
      studentNumber: null,
      supabase: client as never,
    })

    expect(result.ok).toBe(true)
    expect(client.rpc).toHaveBeenCalledWith('join_classroom_by_code_atomic_v1', {
      p_actor_id: '11111111-1111-4111-8111-111111111111',
      p_expected_classroom_id: '33333333-3333-4333-8333-333333333333',
      p_class_code: 'BIO-101',
      p_actor_key_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      p_invitation_key_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      p_first_name: 'Ada',
      p_last_name: 'Lovelace',
      p_student_number: undefined,
      p_pal_event: null,
    })
  })

  it('fails unavailable when the migration is absent or the response drifts', async () => {
    vi.stubEnv('SESSION_SECRET', 'session-secret-that-is-at-least-32-characters')
    const unavailable = createClient({ data: null, error: { code: 'PGRST202' } })
    const malformed = createClient({ data: { ok: true }, error: null })
    const base = {
      actorId: '11111111-1111-4111-8111-111111111111',
      expectedClassroomId: '33333333-3333-4333-8333-333333333333',
      classCode: 'BIO-101',
      firstName: null,
      lastName: null,
      studentNumber: null,
    }

    await expect(joinClassroomByCodeAtomic({ ...base, supabase: unavailable as never }))
      .rejects.toBeInstanceOf(ApiError)
    await expect(joinClassroomByCodeAtomic({ ...base, supabase: malformed as never }))
      .rejects.toMatchObject({ statusCode: 503 })
  })

  it('builds the closed, pseudonymous Pal event only when Pal is enabled', async () => {
    vi.stubEnv('SESSION_SECRET', 'session-secret-that-is-at-least-32-characters')
    vi.stubEnv('PAL_ENABLED', 'true')
    vi.stubEnv('PAL_API_URL', 'http://localhost:4321')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-that-is-at-least-32-characters')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-that-is-at-least-32-characters')
    const client = createClient({
      data: {
        ok: false,
        status: 403,
        error_code: 'enrollment_closed',
      },
      error: null,
    })
    const occurredAt = new Date('2026-09-03T12:00:00.000Z')

    await joinClassroomByCodeAtomic({
      actorId: '11111111-1111-4111-8111-111111111111',
      expectedClassroomId: '33333333-3333-4333-8333-333333333333',
      classCode: 'BIO-101',
      firstName: null,
      lastName: null,
      studentNumber: null,
      occurredAt,
      supabase: client as never,
    })

    const event = client.rpc.mock.calls[0][1].p_pal_event
    expect(v1.validateV1Event(event)).toMatchObject({ ok: true })
    expect(event).toMatchObject({
      schema_version: 1,
      event_type: 'classroom.joined',
      occurred_at: occurredAt.toISOString(),
      metadata: { classroom_token: expect.stringMatching(/^pika-classroom-/) },
    })
    expect(JSON.stringify(event)).not.toContain('33333333-3333-4333-8333-333333333333')
    expect(JSON.stringify(event)).not.toContain('11111111-1111-4111-8111-111111111111')
  })
})

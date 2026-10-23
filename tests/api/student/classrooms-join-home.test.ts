import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/student/classrooms/join/route'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), role: vi.fn(), from: vi.fn(), rpc: vi.fn(), accountDelivery: vi.fn(), membershipDelivery: vi.fn() }))
vi.mock('@/lib/auth', async original => ({ ...await original<typeof import('@/lib/auth')>(), requireAuth: mocks.auth, requireRole: mocks.role }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }))
vi.mock('@/lib/server/pal-outbox', () => ({ attemptImmediatePalEventDelivery: mocks.accountDelivery, attemptMembershipPalActionDelivery: mocks.membershipDelivery }))

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = '33333333-3333-4333-8333-333333333333'
const otherId = '22222222-2222-4222-8222-222222222222'
const enrollmentId = '44444444-4444-4444-8444-444444444444'
const success = { ok: true, status: 201, created: true, already_enrolled: false,
  classroom: { id: classroomId, title: 'Biology', term_label: null },
  enrollment: { id: enrollmentId, created_at: '2026-10-23T12:00:00Z' } }
const request = (body: unknown) => new NextRequest('http://localhost/api/student/classrooms/join', { method: 'POST', body: JSON.stringify(body) })
function lookup(rows = [{ id: classroomId }]) {
  const limit = vi.fn().mockResolvedValue({ data: rows, error: null })
  const filter = vi.fn(() => ({ limit }))
  const eq = vi.fn(() => ({ limit }))
  const select = vi.fn(() => ({ eq, ilike: filter }))
  mocks.from.mockImplementation(table => {
    if (table !== 'classrooms') throw new Error(`Unexpected table: ${table}`)
    return { select }
  })
  return { limit, filter, eq, select }
}

describe('exact-home classroom code joins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_USER_IDS', JSON.stringify([actorId]))
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.stubEnv('PIKA_CLASSROOM_ENROLLMENT_ACCESS_ENABLED', 'false')
    vi.stubEnv('SESSION_SECRET', 'session-secret-that-is-at-least-32-characters')
    vi.stubEnv('PAL_ENABLED', 'false')
    mocks.auth.mockResolvedValue({ id: actorId, email: 'member@example.invalid', role: 'teacher' })
    mocks.role.mockRejectedValue(Object.assign(new Error('Forbidden'), { name: 'AuthorizationError' }))
    mocks.rpc.mockResolvedValue({ data: success, error: null })
    mocks.membershipDelivery.mockResolvedValue('disabled')
    lookup()
  })
  afterEach(() => { vi.unstubAllEnvs() })

  it.each(['teacher', 'student'])('joins a valid new code for a %s actor with a bounded escaped lookup', async role => {
    mocks.auth.mockResolvedValue({ id: actorId, email: 'member@example.invalid', role })
    const query = lookup()
    const response = await POST(request({ classCode: 'BIO_101%', firstName: 'Ada', lastName: 'Lovelace', actorId: otherId }))
    expect(response.status).toBe(201)
    expect(query.select).toHaveBeenCalledExactlyOnceWith('id')
    expect(query.filter).toHaveBeenCalledExactlyOnceWith('class_code', 'BIO\\_101\\%')
    expect(query.limit).toHaveBeenCalledExactlyOnceWith(2)
    expect(mocks.rpc).toHaveBeenCalledWith('join_classroom_by_code_atomic_v1', expect.objectContaining({
      p_actor_id: actorId, p_expected_classroom_id: classroomId, p_class_code: 'BIO_101%', p_pal_event: null,
    }))
    expect(mocks.role).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({ success: true, classroom: { id: classroomId, title: 'Biology' } })
  })

  it.each([{ classroomId }, { classroomId, classCode: 'BIO101' }, { classCode: ' ' }])('rejects direct-ID, mixed, and empty-code input before lookup %#', async body => {
    expect((await POST(request(body))).status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('treats a literal star as an exact code rather than a PostgREST wildcard', async () => {
    const query = lookup()
    expect((await POST(request({ classCode: 'BIO*101' }))).status).toBe(201)
    expect(query.eq).toHaveBeenCalledExactlyOnceWith('class_code', 'BIO*101')
    expect(query.filter).not.toHaveBeenCalled()
    expect(query.limit).toHaveBeenCalledExactlyOnceWith(2)
  })

  it.each([{ rows: [] }, { rows: [{ id: classroomId }, { id: otherId }] }])('charges missing or ambiguous invitation guesses exactly once %#', async ({ rows }) => {
    const query = lookup(rows)
    mocks.rpc.mockResolvedValue({ data: { ok: true }, error: null })
    const response = await POST(request({ classCode: 'BIO101' }))
    expect(response.status).toBe(404)
    expect(query.limit).toHaveBeenCalledExactlyOnceWith(2)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('consume_classroom_join_guess_v1', expect.objectContaining({
      p_actor_key_hash: expect.stringMatching(/^[a-f0-9]{64}$/), p_invitation_key_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
  })

  it.each(['home', 'shared'])('rejects an unmatched %s actor before reading the request or looking up invitations', async gate => {
    if (gate === 'home') vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_USER_IDS', '[]')
    else vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [] }))
    const incoming = request({ classCode: 'BIO101' })
    const read = vi.spyOn(incoming, 'json')
    expect((await POST(incoming)).status).toBe(403)
    expect(read).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('authenticates before parsing the home request or evaluating malformed rollout configuration', async () => {
    mocks.auth.mockRejectedValue(Object.assign(new Error('Unauthorized'), { name: 'AuthenticationError' }))
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{}')
    const incoming = request({ classCode: 'BIO101' })
    const read = vi.spyOn(incoming, 'json')
    expect((await POST(incoming)).status).toBe(401)
    expect(read).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it.each([
    ['not_on_roster', 403], ['owner_self_join', 403], ['enrollment_closed', 403], ['roster_binding_conflict', 409],
  ])('preserves atomic %s denial with no provider dispatch', async (error_code, status) => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, status, error_code }, error: null })
    expect((await POST(request({ classCode: 'BIO101' }))).status).toBe(status)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.accountDelivery).not.toHaveBeenCalled()
    expect(mocks.membershipDelivery).not.toHaveBeenCalled()
  })

  it('preserves rate-limit status and Retry-After without an uncharged retry', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, status: 429, error_code: 'rate_limited', retry_after_seconds: 42 }, error: null })
    const response = await POST(request({ classCode: 'BIO101' }))
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('42')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('preserves the atomic profile-required handoff for an open classroom', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, status: 400, error_code: 'profile_required', required_fields: ['firstName', 'lastName'] }, error: null })
    const response = await POST(request({ classCode: 'BIO101' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'profile_required', requiredFields: ['firstName', 'lastName'] })
    expect(mocks.accountDelivery).not.toHaveBeenCalled()
    expect(mocks.membershipDelivery).not.toHaveBeenCalled()
  })

  it('uses membership delivery with no account fallback even when legacy Pal is enabled', async () => {
    vi.stubEnv('PAL_ENABLED', 'true')
    vi.stubEnv('PAL_CLASSROOM_ENABLED', 'false')
    vi.stubEnv('PAL_API_URL', 'http://localhost:4321')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-that-is-at-least-32-characters')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-that-is-at-least-32-characters')
    expect((await POST(request({ classCode: 'BIO101', membershipOnly: false }))).status).toBe(201)
    expect(mocks.rpc).toHaveBeenCalledWith('join_classroom_by_code_atomic_v1', expect.objectContaining({ p_pal_event: null }))
    expect(mocks.accountDelivery).not.toHaveBeenCalled()
    expect(mocks.membershipDelivery).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ membership: { studentId: actorId, classroomId } }))
  })

  it('does not dispatch another Pal event for an already-enrolled retry', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...success, status: 200, created: false, already_enrolled: true }, error: null })
    const response = await POST(request({ classCode: 'BIO101' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ alreadyEnrolled: true })
    expect(mocks.accountDelivery).not.toHaveBeenCalled()
    expect(mocks.membershipDelivery).not.toHaveBeenCalled()
  })
})

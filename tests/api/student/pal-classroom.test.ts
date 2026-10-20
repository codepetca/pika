import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), current: vi.fn(), token: vi.fn(), legacy: vi.fn(), visit: vi.fn(), contextualToken: vi.fn(), contextualVisit: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRole: mocks.auth, requireAuth: mocks.current }))
vi.mock('@/lib/server/pal-read-token', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/server/pal-read-token')>(), getPalReadTokenForStudent: mocks.legacy }))
vi.mock('@/lib/server/pal-classroom', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/server/pal-classroom')>(), getMembershipPalReadToken: mocks.token, recordPalClassroomVisit: mocks.visit }))
vi.mock('@/lib/server/contextual-pal-classroom', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server/contextual-pal-classroom')>(),
  getContextualPalReadToken: mocks.contextualToken,
  recordContextualPalClassroomVisit: mocks.contextualVisit,
}))
vi.mock('@/lib/server/pal-outbox', () => ({ attemptMembershipPalActionDelivery: vi.fn().mockResolvedValue('pending') }))
import { POST as tokenRoute } from '@/app/api/student/pal/read-token/route'
import { POST as visitRoute } from '@/app/api/student/pal/classroom-visit/route'
import { ApiError } from '@/lib/api-error'

const classroomId = 'c1690000-0000-4000-8000-000000000010'
const scopeKey = `pika-classroom-v1-${'a'.repeat(64)}`
const context = { params: Promise.resolve({}) }
function request(path: string, body: unknown, origin = 'http://localhost') {
  return new Request(`http://localhost/api/student/pal/${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', origin }, body: JSON.stringify(body) })
}

describe('membership Pal browser routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    vi.stubEnv('PAL_ENABLED', 'true')
    vi.stubEnv('PAL_CLASSROOM_ENABLED', 'true')
    vi.stubEnv('PAL_MEMBERSHIP_IDENTITY_ENABLED', 'true')
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-'.repeat(3))
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-'.repeat(3))
    mocks.auth.mockResolvedValue({ id: 'session-student', role: 'student' })
    mocks.token.mockResolvedValue({ token: 'scoped', expires_at: '2026-09-12T20:00:00Z', scope_key: scopeKey })
    mocks.visit.mockResolvedValue(undefined)
    mocks.contextualToken.mockResolvedValue({ token: 'contextual', expires_at: '2026-09-12T20:00:00Z', scope_key: scopeKey })
    mocks.contextualVisit.mockResolvedValue(undefined)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('derives the actor from the session and returns no-store scoped tokens', async () => {
    const response = await tokenRoute(request('read-token', { classroomId, scopeKey }) as never, context)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.token).toHaveBeenCalledWith({ studentId: 'session-student', classroomId, scopeKey })
    expect(mocks.legacy).not.toHaveBeenCalled()
  })

  it('does not accept account identity or fallback after membership denial', async () => {
    expect((await tokenRoute(request('read-token', { classroomId, scopeKey, studentId: 'other' }) as never, context)).status).toBe(400)
    mocks.token.mockRejectedValue(new ApiError(403, 'Classroom achievements access is unavailable'))
    const response = await tokenRoute(request('read-token', { classroomId, scopeKey }) as never, context)
    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.legacy).not.toHaveBeenCalled()
  })

  it('does not send a scoped client back to the legacy provider if rollout is disabled mid-request', async () => {
    vi.stubEnv('PAL_CLASSROOM_ENABLED', 'false')
    expect((await tokenRoute(request('read-token', { classroomId, scopeKey }) as never, context)).status).toBe(404)
    expect(mocks.legacy).not.toHaveBeenCalled()
  })

  it('records only same-origin authenticated classroom visits', async () => {
    expect((await visitRoute(request('classroom-visit', { classroomId }, 'https://other.test') as never, context)).status).toBe(403)
    expect(mocks.visit).not.toHaveBeenCalled()
    expect((await visitRoute(request('classroom-visit', { classroomId }) as never, context)).status).toBe(200)
    expect(mocks.visit).toHaveBeenCalledWith({ studentId: 'session-student', classroomId })
  })

  it('does nothing for disabled or unauthenticated visits', async () => {
    vi.stubEnv('PAL_CLASSROOM_ENABLED', 'false')
    expect((await visitRoute(request('classroom-visit', { classroomId }) as never, context)).status).toBe(404)
    expect(mocks.visit).not.toHaveBeenCalled()
    mocks.auth.mockRejectedValue(new ApiError(401, 'Unauthorized'))
    expect((await tokenRoute(request('read-token', { classroomId, scopeKey }) as never, context)).status).toBe(401)
    expect(mocks.token).not.toHaveBeenCalled()
  })

  it.each(['teacher', 'student'])('uses current membership for an admitted %s without calling the legacy guard', async role => {
    const id = 'c1690000-0000-4000-8000-000000000002'
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [id] }))
    mocks.current.mockResolvedValue({ id, role })
    expect((await tokenRoute(request('read-token', { classroomId, scopeKey }) as never, context)).status).toBe(200)
    expect(mocks.contextualToken).toHaveBeenCalledWith({ studentId: id, classroomId, scopeKey })
    expect((await visitRoute(request('classroom-visit', { classroomId }) as never, context)).status).toBe(200)
    expect(mocks.contextualVisit).toHaveBeenCalledWith({ studentId: id, classroomId })
    expect(mocks.auth).not.toHaveBeenCalled()
    expect(mocks.token).not.toHaveBeenCalled()
    expect(mocks.visit).not.toHaveBeenCalled()
    expect(mocks.legacy).not.toHaveBeenCalled()
  })

  it('preserves unmatched admission and rejects malformed admission without minting', async () => {
    mocks.current.mockResolvedValue({ id: 'c1690000-0000-4000-8000-000000000002', role: 'student' })
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [] }))
    expect((await tokenRoute(request('read-token', { classroomId, scopeKey }) as never, context)).status).toBe(200)
    expect(mocks.token).toHaveBeenCalledOnce()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{}')
    expect((await tokenRoute(request('read-token', { classroomId, scopeKey }) as never, context)).status).toBe(503)
    expect(mocks.contextualToken).not.toHaveBeenCalled()
  })

  it('never treats admission as permission for account-level mint', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: ['c1690000-0000-4000-8000-000000000002'] }))
    vi.stubEnv('PAL_CLASSROOM_ENABLED', 'false')
    mocks.auth.mockRejectedValue(new ApiError(403, 'Forbidden'))
    const response = await tokenRoute(new Request('http://localhost/api/student/pal/read-token', { method: 'POST' }) as never, context)
    expect(response.status).toBe(403)
    expect(mocks.current).not.toHaveBeenCalled()
    expect(mocks.legacy).not.toHaveBeenCalled()
  })

  it('returns contextual denial and conflict without legacy fallback or repeat', async () => {
    const id = 'c1690000-0000-4000-8000-000000000002'
    mocks.current.mockResolvedValue({ id, role: 'teacher' })
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [id] }))
    mocks.contextualToken.mockRejectedValue(new ApiError(409, 'Classroom achievements changed; retry'))
    const response = await tokenRoute(request('read-token', { classroomId, scopeKey }) as never, context)
    expect(response.status).toBe(409)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.contextualToken).toHaveBeenCalledOnce()
    expect(mocks.token).not.toHaveBeenCalled()
    expect(mocks.legacy).not.toHaveBeenCalled()
  })
})

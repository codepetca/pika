import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), token: vi.fn(), legacy: vi.fn(), visit: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRole: mocks.auth }))
vi.mock('@/lib/server/pal-read-token', () => ({ getPalReadTokenForStudent: mocks.legacy }))
vi.mock('@/lib/server/pal-classroom', () => ({ getMembershipPalReadToken: mocks.token, recordPalClassroomVisit: mocks.visit }))
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
    vi.stubEnv('PAL_ENABLED', 'true')
    vi.stubEnv('PAL_CLASSROOM_ENABLED', 'true')
    vi.stubEnv('PAL_MEMBERSHIP_IDENTITY_ENABLED', 'true')
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-'.repeat(3))
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-'.repeat(3))
    mocks.auth.mockResolvedValue({ id: 'session-student', role: 'student' })
    mocks.token.mockResolvedValue({ token: 'scoped', expires_at: '2026-09-12T20:00:00Z', scope_key: scopeKey })
    mocks.visit.mockResolvedValue(undefined)
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
})

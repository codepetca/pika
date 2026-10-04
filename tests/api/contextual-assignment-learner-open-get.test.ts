import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-error'
import { GET } from '@/app/api/assignment-docs/[id]/route'

const actorId = '11111111-1111-4111-8111-111111111111'
const assignmentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), read: vi.fn(), legacy: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth, requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.client }))
vi.mock('@/lib/server/contextual-assignment-learner-open', () => ({ openSharedAssignmentLearnerDoc: mocks.read }))
vi.mock('@/lib/server/contextual-assignment-doc-access', async original => ({
  ...await original<typeof import('@/lib/server/contextual-assignment-doc-access')>(), resolveContextualAssignmentDocAccess: mocks.legacy,
}))
const request = (query = '') => new NextRequest(`http://localhost/api/assignment-docs/${assignmentId}${query}`)
const context = (id = assignmentId) => ({ params: Promise.resolve({ id }) })
beforeEach(() => {
  vi.unstubAllEnvs(); vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ id: actorId, role: 'student' }); mocks.client.mockReturnValue({})
  mocks.read.mockResolvedValue({ assignment: { id: assignmentId }, doc: { student_id: actorId } })
  mocks.legacy.mockImplementation(() => { throw new ApiError(404, 'Legacy sentinel') })
})
describe('shared learner open route boundary', () => {
  it.each(['teacher', 'student'])('opens admitted %s using its own authenticated identity', async role => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    mocks.auth.mockResolvedValue({ id: actorId, role })
    expect((await GET(request(), context(assignmentId.toUpperCase()))).status).toBe(200)
    expect(mocks.read).toHaveBeenCalledWith({ supabase: {}, actorId, assignmentId })
    expect(mocks.legacy).not.toHaveBeenCalled()
  })
  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [] })])('keeps existing fallback for %s', async value => {
    if (value !== undefined) vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', value)
    expect((await GET(request(), context('old-id'))).status).toBe(404)
    expect(mocks.auth).toHaveBeenCalledOnce(); expect(mocks.legacy).toHaveBeenCalledOnce()
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it.each(['{bad', '{"version":2,"admittedUserIds":[]}'])('rejects malformed admission before params/client', async value => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', value)
    let touched = false
    const response = await GET(request(), { get params() { touched = true; return Promise.resolve({ id: 'bad' }) } })
    expect(response.status).toBe(503); expect(touched).toBe(false)
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled()
  })
  it('authenticates before strict admission', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{bad'); mocks.auth.mockRejectedValue(new ApiError(401, 'Unauthorized'))
    expect((await GET(request(), context())).status).toBe(401); expect(mocks.client).not.toHaveBeenCalled()
  })
  it.each(['?student_id=', '?student_id=other'])('rejects student substitution before client', async query => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    expect((await GET(request(query), context())).status).toBe(400); expect(mocks.client).not.toHaveBeenCalled()
  })
  it('validates admitted assignment UUID before client', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    expect((await GET(request(), context('bad'))).status).toBe(400); expect(mocks.client).not.toHaveBeenCalled()
  })
  it.each([403, 404, 503])('does not fall back after shared failure %s', async statusCode => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    mocks.read.mockRejectedValue(new ApiError(statusCode, 'Denied'))
    expect((await GET(request(), context())).status).toBe(statusCode); expect(mocks.legacy).not.toHaveBeenCalled()
  })
})

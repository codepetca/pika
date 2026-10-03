import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthenticationError, AuthorizationError } from '@/lib/auth'
import { GET } from '@/app/api/teacher/classrooms/[id]/roster/route'
import { ApiError } from '@/lib/api-error'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), role: vi.fn(), read: vi.fn(), client: vi.fn(), legacyOwner: vi.fn(), availability: vi.fn() }))
vi.mock('@/lib/auth', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/auth')>(), requireAuth: mocks.auth, requireRole: mocks.role }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.client }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherOwnsClassroom: mocks.legacyOwner }))
vi.mock('@/lib/server/student-purge', () => ({ getStudentPurgeEnabledStudentIds: mocks.availability }))
vi.mock('@/lib/server/contextual-classroom-roster-read', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/server/contextual-classroom-roster-read')>(), readContextualClassroomRoster: mocks.read }))

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const request = () => new NextRequest('http://localhost/roster')
const context = (id = classroomId) => ({ params: Promise.resolve({ id }) })

describe('shared roster GET admission boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    mocks.client.mockReturnValue({})
    mocks.auth.mockResolvedValue({ id: actorId, role: 'teacher', email: 'actor@example.test' })
    mocks.role.mockResolvedValue({ id: actorId, role: 'teacher', email: 'actor@example.test' })
    mocks.read.mockResolvedValue({ roster: [], student_purge_enabled_ids: [] })
    mocks.legacyOwner.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
  })

  it.each(['teacher', 'student'])('admits an authenticated %s owner without the global teacher guard', async role => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    mocks.auth.mockResolvedValue({ id: actorId, role, email: 'actor@example.test' })
    const response = await GET(request(), context())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ roster: [], student_purge_enabled_ids: [] })
    expect(mocks.role).not.toHaveBeenCalled()
    expect(mocks.legacyOwner).not.toHaveBeenCalled()
    expect(mocks.read).toHaveBeenCalledWith({ supabase: {}, actorId, classroomId })
  })

  it('authenticates before malformed admission and invalid params', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', 'bad')
    mocks.auth.mockRejectedValue(new AuthenticationError('Unauthorized'))
    expect((await GET(request(), context('bad'))).status).toBe(401)
    expect(mocks.client).not.toHaveBeenCalled()
  })

  it('rejects malformed present admission before params/client reads', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', 'bad')
    expect((await GET(request(), context('bad'))).status).toBe(503)
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.client).not.toHaveBeenCalled()
  })

  it('validates admitted params with the named feature boundary', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    expect((await GET(request(), context('bad'))).status).toBe(400)
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it.each([403, 404, 503])('retains helper denial/unavailable status %i without legacy fallback', async statusCode => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    mocks.read.mockRejectedValue(new ApiError(statusCode, 'Failed current owner proof'))
    expect((await GET(request(), context())).status).toBe(statusCode)
    expect(mocks.legacyOwner).not.toHaveBeenCalled()
    expect(mocks.role).not.toHaveBeenCalled()
  })

  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [] })])('keeps absent/unmatched requests on legacy guards %#', async config => {
    if (config !== undefined) vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
    expect((await GET(request(), context('legacy-nonuuid'))).status).toBe(403)
    expect(mocks.role).toHaveBeenCalledWith('teacher')
    expect(mocks.legacyOwner).toHaveBeenCalledWith(actorId, 'legacy-nonuuid')
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('keeps unmatched students denied by the original role guard', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [] }))
    mocks.role.mockRejectedValue(new AuthorizationError('Forbidden'))
    expect((await GET(request(), context())).status).toBe(403)
    expect(mocks.read).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-error'
import { GET } from '@/app/api/teacher/assignments/[id]/students/[studentId]/route'

const actorId = '11111111-1111-4111-8111-111111111111'
const assignmentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const studentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), legacy: vi.fn(), read: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth, requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.client }))
vi.mock('@/lib/server/classroom-assignment-detail-access', async original => ({
  ...await original<typeof import('@/lib/server/classroom-assignment-detail-access')>(), authorizeClassroomAssignmentDetailRequest: mocks.legacy,
}))
vi.mock('@/lib/server/contextual-assignment-student-detail-read', async original => ({
  ...await original<typeof import('@/lib/server/contextual-assignment-student-detail-read')>(), readContextualAssignmentStudentDetail: mocks.read,
}))
const request = () => new NextRequest(`http://localhost/api/teacher/assignments/${assignmentId}/students/${studentId}`)
const admission = (ids = [actorId]) => vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: ids }))
beforeEach(() => {
  vi.unstubAllEnvs(); vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ id: actorId, role: 'student' }); mocks.client.mockReturnValue({})
  mocks.read.mockResolvedValue({ assignment: { id: assignmentId }, student: { id: studentId } })
  mocks.legacy.mockRejectedValue(new ApiError(404, 'Legacy sentinel'))
})
describe('shared exact student detail admission', () => {
  it.each(['teacher', 'student'])('dispatches admitted role %s after canonical parameter decoding', async role => {
    admission(); mocks.auth.mockResolvedValue({ id: actorId, role })
    const response = await GET(request(), { params: Promise.resolve({ id: assignmentId.toUpperCase(), studentId: studentId.toUpperCase() }) })
    expect(response.status).toBe(200)
    expect(mocks.read).toHaveBeenCalledWith({ supabase: {}, actorId, assignmentId, studentId })
    expect(mocks.legacy).not.toHaveBeenCalled()
  })
  it('preserves absent configuration with no new authentication or parameter decoding', async () => {
    const response = await GET(request(), { params: Promise.resolve({ id: 'old-id', studentId: 'old-student' }) })
    expect(response.status).toBe(404); expect(mocks.auth).not.toHaveBeenCalled()
    expect(mocks.legacy).toHaveBeenCalledOnce(); expect(mocks.read).not.toHaveBeenCalled()
  })
  it('retains authenticated unadmitted exact-pair/legacy fallback', async () => {
    admission([])
    const response = await GET(request(), { params: Promise.resolve({ id: 'old-id', studentId: 'old-student' }) })
    expect(response.status).toBe(404); expect(mocks.auth).toHaveBeenCalledOnce(); expect(mocks.legacy).toHaveBeenCalledOnce()
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it.each(['{bad', JSON.stringify({ version: 2, admittedUserIds: [] }), JSON.stringify({ version: 1, admittedUserIds: [actorId, actorId] })])('rejects malformed present configuration before params/client/fallback', async config => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
    let accessed = false
    const response = await GET(request(), { get params() { accessed = true; return Promise.resolve({ id: 'bad', studentId: 'bad' }) } })
    expect(response.status).toBe(503); expect(accessed).toBe(false); expect(mocks.auth).toHaveBeenCalledOnce()
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled()
  })
  it('authenticates before present configuration decoding', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{bad'); mocks.auth.mockRejectedValue(new ApiError(401, 'Unauthorized'))
    expect((await GET(request(), { params: Promise.resolve({ id: 'bad', studentId: 'bad' }) })).status).toBe(401)
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled()
  })
  it.each([{ id: 'bad', studentId }, { id: assignmentId, studentId: 'bad' }])('validates both admitted IDs before client creation %#', async params => {
    admission(); expect((await GET(request(), { params: Promise.resolve(params) })).status).toBe(400)
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled()
  })
  it.each([403, 404, 503])('never falls back after shared reader status %s', async status => {
    admission(); mocks.read.mockRejectedValue(new ApiError(status, 'Read denied'))
    expect((await GET(request(), { params: Promise.resolve({ id: assignmentId, studentId }) })).status).toBe(status)
    expect(mocks.legacy).not.toHaveBeenCalled()
  })
})

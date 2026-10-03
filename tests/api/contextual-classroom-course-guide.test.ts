import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-error'
import { GET } from '@/app/api/classrooms/[classroomId]/course-guide/route'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), core: vi.fn(), read: vi.fn(), legacy: vi.fn(), client: vi.fn(), owner: vi.fn(), member: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.client }))
vi.mock('@/lib/server/classroom-core-access', () => ({ authorizeClassroomCoreRequest: mocks.core }))
vi.mock('@/lib/server/course-guide', () => ({ getClassroomCourseGuide: mocks.legacy }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherOwnsClassroom: mocks.owner, assertStudentCanAccessClassroom: mocks.member }))
vi.mock('@/lib/server/contextual-course-guide-read', async importOriginal => ({ ...await importOriginal<object>(), readContextualCourseGuide: mocks.read }))
const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const guide = { classroom: { title: 'Course' }, visibility: { overview: false, resources: false, assignments: false, tests: false }, overviewMarkdown: '', resourcesContent: null, assignments: [], tests: [] }
const request = () => new NextRequest(`http://localhost/api/classrooms/${classroomId}/course-guide?now=2099-01-01`)
const context = () => ({ params: Promise.resolve({ classroomId: classroomId.toUpperCase() }) })
describe('shared CourseGuide GET boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    mocks.auth.mockResolvedValue({ id: actorId, role: 'student' })
    mocks.read.mockResolvedValue(guide)
    mocks.client.mockReturnValue({ client: true })
    mocks.legacy.mockResolvedValue({ ok: true, guide })
    mocks.owner.mockResolvedValue({ ok: true })
    mocks.member.mockResolvedValue({ ok: true, classroom: { feature_visibility: { syllabus: true } } })
  })
  afterEach(() => vi.unstubAllEnvs())
  it.each(['student', 'teacher'])('passes identity for either global role, canonical params and no HTTP clock (%s)', async role => {
    mocks.auth.mockResolvedValue({ id: actorId, role })
    const response = await GET(request(), context())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ guide })
    expect(mocks.auth).toHaveBeenCalledTimes(1)
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith({ supabase: { client: true }, actorId, classroomId })
    expect(mocks.core).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled()
  })
  it('authenticates before hostile params and malformed configured admission', async () => {
    const error = new Error('denied'); error.name = 'AuthenticationError'
    mocks.auth.mockRejectedValue(error)
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', 'bad')
    const params = vi.fn(() => { throw new Error('params must not be read') })
    const hostile = Object.defineProperty({}, 'params', { get: params })
    const response = await GET(request(), hostile as { params: Promise<Record<string, string>> })
    expect(response.status).toBe(401); expect(params).not.toHaveBeenCalled()
  })
  it('resolves admission once before params and fails configured malformed admission without fallback', async () => {
    const params = vi.fn(() => { throw new Error('params must not be read') })
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', 'bad')
    const hostile = Object.defineProperty({}, 'params', { get: params })
    expect((await GET(request(), hostile as { params: Promise<Record<string, string>> })).status).toBe(503)
    expect(params).not.toHaveBeenCalled(); expect(mocks.core).not.toHaveBeenCalled()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    const changing = Object.defineProperty({}, 'params', { get: () => { process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION = 'bad'; return Promise.resolve({ classroomId }) } })
    expect((await GET(request(), changing as { params: Promise<Record<string, string>> })).status).toBe(200)
  })
  it.each([403, 404, 503])('does not fall back on shared reader failure %s', async status => {
    mocks.read.mockRejectedValue(new ApiError(status, 'Controlled failure'))
    expect((await GET(request(), context())).status).toBe(status)
    expect(mocks.legacy).not.toHaveBeenCalled(); expect(mocks.core).not.toHaveBeenCalled()
  })
  it('rejects malformed and extra shared params after authentication', async () => {
    for (const params of [{ classroomId: 'bad' }, { classroomId, extra: 'value' }]) {
      expect((await GET(request(), { params: Promise.resolve(params) })).status).toBe(400)
    }
    expect(mocks.auth).toHaveBeenCalledTimes(2); expect(mocks.read).not.toHaveBeenCalled()
  })
  it.each(['absent', 'unmatched'])('retains the literal existing path (%s)', async configuration => {
    if (configuration === 'absent') vi.unstubAllEnvs()
    else vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [] }))
    mocks.core.mockResolvedValue({ mode: 'legacy', user: { id: actorId, role: 'teacher' } })
    expect((await GET(request(), context())).status).toBe(200)
    expect(mocks.core).toHaveBeenCalledWith(classroomId.toUpperCase(), { permission: 'read' })
    expect(mocks.legacy).toHaveBeenCalledWith(classroomId.toUpperCase())
    expect(mocks.read).not.toHaveBeenCalled()
  })
})

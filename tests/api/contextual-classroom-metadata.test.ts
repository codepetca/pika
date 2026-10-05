import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-error'
import { PATCH, GET } from '@/app/api/teacher/classrooms/[id]/route'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), core: vi.fn(), update: vi.fn(), client: vi.fn(), detail: vi.fn(), owner: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.client }))
vi.mock('@/lib/server/classroom-core-access', () => ({ authorizeClassroomCoreRequest: mocks.core, assertClassroomCoreWriteResponse: vi.fn() }))
vi.mock('@/lib/server/classrooms', async importOriginal => ({ ...await importOriginal<object>(), assertTeacherOwnsClassroom: mocks.owner }))
vi.mock('@/lib/server/contextual-classroom-metadata', async importOriginal => ({ ...await importOriginal<object>(), updateContextualClassroomMetadata: mocks.update }))
vi.mock('@/lib/server/contextual-classroom-detail', async importOriginal => ({ ...await importOriginal<object>(), readContextualClassroomDetail: mocks.detail }))
const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const classroom = { id: classroomId, teacher_id: actorId, title: 'Changed' }
const request = (patch: unknown = { title: 'Changed' }) => new NextRequest(`http://localhost/api/teacher/classrooms/${classroomId}`, { method: 'PATCH', body: JSON.stringify(patch) })
const context = () => ({ params: Promise.resolve({ id: classroomId.toUpperCase() }) })
describe('metadata-only shared classroom PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    mocks.auth.mockResolvedValue({ id: actorId, role: 'student' })
    mocks.client.mockReturnValue({ client: true })
    mocks.update.mockResolvedValue(classroom)
    mocks.detail.mockResolvedValue(classroom)
  })
  afterEach(() => vi.unstubAllEnvs())
  it.each(['teacher', 'student'])('accepts role-neutral owner identity and canonical UUID (%s)', async role => {
    mocks.auth.mockResolvedValue({ id: actorId, role })
    const response = await PATCH(request(), context())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ classroom })
    expect(mocks.auth).toHaveBeenCalledTimes(1)
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ supabase: { client: true }, actorId, classroomId, patch: { title: 'Changed' } })
    expect(mocks.core).not.toHaveBeenCalled()
  })
  it('authenticates before hostile params/body/config', async () => {
    const error = new Error('denied'); error.name = 'AuthenticationError'
    mocks.auth.mockRejectedValue(error); vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', 'bad')
    const params = vi.fn(() => { throw new Error('params read before authentication') })
    const hostile = Object.defineProperty({ params: Promise.resolve({ id: classroomId }) }, 'params', { get: params })
    const req = request(); const body = vi.spyOn(req, 'json').mockRejectedValue(new Error('body read before authentication'))
    expect((await PATCH(req, hostile)).status).toBe(401)
    expect(params).not.toHaveBeenCalled(); expect(body).not.toHaveBeenCalled()
  })
  it('rejects malformed admission before params/body and resolves admission once', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', 'bad')
    const params = vi.fn(() => { throw new Error('params read before admission') })
    const hostile = Object.defineProperty({ params: Promise.resolve({ id: classroomId }) }, 'params', { get: params })
    const req = request(); const body = vi.spyOn(req, 'json')
    expect((await PATCH(req, hostile)).status).toBe(503)
    expect(params).not.toHaveBeenCalled(); expect(body).not.toHaveBeenCalled()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    const changing = Object.defineProperty({ params: Promise.resolve({ id: classroomId }) }, 'params', { get: () => { process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION = 'bad'; return Promise.resolve({ id: classroomId }) } })
    expect((await PATCH(request(), changing)).status).toBe(200)
  })
  it.each([{}, { archived: true }, { archived: false }, { archived: null }, { title: 'Changed', archived: false }, { position: 2 }, { actorId }, { manual_attendance_revision: 1 }, { unknown: true }])('rejects lifecycle/unknown/empty shared keys before writes %#', async patch => {
    expect((await PATCH(request(patch), context())).status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.core).not.toHaveBeenCalled()
  })
  it('parses params before body and rejects malformed JSON', async () => {
    const req = request(); const body = vi.spyOn(req, 'json')
    expect((await PATCH(req, { params: Promise.resolve({ id: 'bad' }) })).status).toBe(400)
    expect(body).not.toHaveBeenCalled()
    const malformed = new NextRequest('http://localhost/api/teacher/classrooms/test', { method: 'PATCH', body: '{bad' })
    expect((await PATCH(malformed, context())).status).toBe(400)
  })
  it.each([400, 403, 404, 409, 503])('does not retry or invoke legacy authorization on shared error %s', async status => {
    mocks.update.mockRejectedValue(new ApiError(status, 'Controlled failure'))
    expect((await PATCH(request(), context())).status).toBe(status)
    expect(mocks.update).toHaveBeenCalledTimes(1); expect(mocks.core).not.toHaveBeenCalled()
  })
  it.each(['absent', 'unmatched'])('preserves the existing PATCH entry and empty-body response (%s)', async config => {
    if (config === 'absent') vi.unstubAllEnvs()
    else vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [] }))
    mocks.core.mockResolvedValue({ mode: 'legacy', user: { id: actorId, role: 'teacher' } })
    const response = await PATCH(request({}), context())
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'No fields to update' })
    expect(mocks.core).toHaveBeenCalledWith(classroomId.toUpperCase(), { legacyRole: 'teacher', permission: 'owner' })
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('leaves the existing shared detail GET on its existing schema/reader', async () => {
    const response = await GET(new NextRequest('http://localhost/api/teacher/classrooms/test'), context())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ classroom })
    expect(mocks.detail).toHaveBeenCalledExactlyOnceWith({ supabase: { client: true }, actorId, classroomId, permission: 'owner' })
    expect(mocks.update).not.toHaveBeenCalled()
  })
})

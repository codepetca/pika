import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthenticationError, AuthorizationError, requireAuth, requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { POST } from '@/app/api/teacher/classrooms/[id]/announcements/route'
import { PATCH, DELETE } from '@/app/api/teacher/classrooms/[id]/announcements/[announcementId]/route'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/auth', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/auth')>(), requireAuth: vi.fn(), requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherCanMutateClassroom: vi.fn(), assertTeacherOwnsClassroom: vi.fn() }))
const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const announcementId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const timestamp = '2026-10-01T12:00:00.000Z'
const announcement = { id: announcementId, classroom_id: classroomId, content: 'Content', title: null, created_by: actorId, is_draft: false, published_at: timestamp, scheduled_for: null, created_at: timestamp, updated_at: timestamp }
const rpc = vi.fn()
const from = vi.fn()
const user = (role: 'student' | 'teacher') => ({ id: actorId, role, email: 'actor@example.test' } as AuthenticatedUser)
const routes = [
  { method: 'POST', handler: POST, status: 201, params: { id: classroomId }, result: { announcement } },
  { method: 'PATCH', handler: PATCH, status: 200, params: { id: classroomId, announcementId }, result: { announcement } },
  { method: 'DELETE', handler: DELETE, status: 200, params: { id: classroomId, announcementId }, result: { success: true } },
] as const
function request(method: string, body: unknown = { content: ' Content ' }) {
  return new NextRequest('http://localhost/api/teacher/classrooms/announcements', { method, ...(method === 'DELETE' ? {} : { body: JSON.stringify(body) }) })
}
function responseFor(method: string) {
  return { data: method === 'DELETE' ? { deleted: true, classroom_id: classroomId, announcement_id: announcementId } : { announcement }, error: null }
}

describe('shared-admission owner announcement writes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    vi.mocked(getServiceRoleClient).mockReturnValue({ rpc, from } as unknown as ReturnType<typeof getServiceRoleClient>)
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each(routes.flatMap(route => ['teacher', 'student'].map(role => ({ ...route, role: role as 'teacher' | 'student' }))))('permits admitted global $role through the owner $method RPC', async ({ method, handler, status, params, result, role }) => {
    vi.mocked(requireAuth).mockResolvedValue(user(role))
    rpc.mockResolvedValue(responseFor(method))
    const response = await handler(request(method), { params: Promise.resolve(params) })
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual(result)
    expect(requireRole).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
    expect(assertTeacherCanMutateClassroom).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it.each(routes)('authenticates before malformed configuration, deferred params or body on $method', async ({ method, handler }) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{')
    vi.mocked(requireAuth).mockRejectedValue(new AuthenticationError())
    const then = vi.fn()
    const req = request(method)
    const json = vi.spyOn(req, 'json')
    expect((await handler(req, { params: { then } as unknown as Promise<Record<string, string>> })).status).toBe(401)
    expect(then).not.toHaveBeenCalled()
    expect(json).not.toHaveBeenCalled()
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it.each(routes)('rejects malformed present config before params or body on $method', async ({ method, handler }) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{')
    const then = vi.fn()
    const req = request(method)
    const json = vi.spyOn(req, 'json')
    expect((await handler(req, { params: { then } as unknown as Promise<Record<string, string>> })).status).toBe(503)
    expect(then).not.toHaveBeenCalled()
    expect(json).not.toHaveBeenCalled()
    expect(requireRole).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each(routes)('rejects malformed $method UUIDs with the real helper and no SDK work', async ({ method, handler, params }) => {
    const req = request(method)
    const json = vi.spyOn(req, 'json')
    expect((await handler(req, { params: Promise.resolve({ ...params, id: 'invalid' }) })).status).toBe(400)
    expect(json).not.toHaveBeenCalled()
    expect(getServiceRoleClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each(routes.slice(1))('rejects malformed $method announcement IDs before reading body', async ({ method, handler, params }) => {
    const req = request(method)
    const json = vi.spyOn(req, 'json')
    expect((await handler(req, { params: Promise.resolve({ ...params, announcementId: 'invalid' }) })).status).toBe(400)
    expect(json).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each(routes.flatMap(route => [undefined, JSON.stringify({ version: 1, admittedUserIds: [] })].map(config => ({ ...route, config }))))('retains legacy teacher role guard for $method with config $config', async ({ method, handler, params, config }) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
    vi.mocked(requireRole).mockRejectedValue(new AuthorizationError())
    expect((await handler(request(method), { params: Promise.resolve(params) })).status).toBe(403)
    expect(requireRole).toHaveBeenCalledWith('teacher')
    expect(rpc).not.toHaveBeenCalled()
    if (config === undefined) expect(requireAuth).not.toHaveBeenCalled()
  })

  it.each(routes)('maps transaction-time owner/archive denial on $method', async ({ method, handler, params }) => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Owner removed' } })
    const response = await handler(request(method), { params: Promise.resolve(params) })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
  })

  it.each([{}, { content: '' }, { title: 2 }, { content: 'Content', created_by: actorId }, { is_draft: true, scheduled_for: '2099-01-01' }, { scheduled_for: '+010000-01-01T00:00:00.000Z' }])('rejects invalid shared PATCH body %j before SDK', async body => {
    expect((await PATCH(request('PATCH', body), { params: Promise.resolve(routes[1].params) })).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects out-of-range normalized schedule years on create before SDK work', async () => {
    expect((await POST(request('POST', { content: 'Content', scheduled_for: '+010000-01-01T00:00:00.000Z' }), { params: Promise.resolve(routes[0].params) })).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([POST, PATCH])('maps malformed JSON to 400 without invoking SDK %#', async handler => {
    const req = new NextRequest('http://localhost/api/announcements', { method: 'POST', body: '{' })
    const params = handler === POST ? routes[0].params : routes[1].params
    expect((await handler(req, { params: Promise.resolve(params) })).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('retains legacy classroom mutation guard when admission is absent', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    vi.mocked(requireRole).mockResolvedValue(user('teacher'))
    vi.mocked(assertTeacherCanMutateClassroom).mockResolvedValue({ ok: false, status: 403, error: 'Classroom is archived' })
    const response = await POST(request('POST'), { params: Promise.resolve(routes[0].params) })
    expect(response.status).toBe(403)
    expect(assertTeacherCanMutateClassroom).toHaveBeenCalledWith(actorId, classroomId)
    expect(rpc).not.toHaveBeenCalled()
  })
})

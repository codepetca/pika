import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthenticationError, AuthorizationError, requireAuth, requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { POST } from '@/app/api/teacher/classrooms/[id]/roster/remove/route'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/auth', async original => ({ ...await original<typeof import('@/lib/auth')>(), requireAuth: vi.fn(), requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherCanMutateClassroom: vi.fn() }))
const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const rosterId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const user = (role: 'teacher' | 'student') => ({ id: actorId, role, email: 'owner@example.test' } as AuthenticatedUser)
const context = { params: Promise.resolve({ id: classroomId }) }
const request = (body: unknown = { roster_ids: [rosterId] }) => new NextRequest('http://localhost/remove', { method: 'POST', body: JSON.stringify(body) })
const rpc = vi.fn(), from = vi.fn()

describe('shared preserving roster removal route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.mocked(getServiceRoleClient).mockReturnValue({ rpc, from } as unknown as ReturnType<typeof getServiceRoleClient>)
    rpc.mockResolvedValue({ data: { actor_id: actorId, classroom_id: classroomId, roster_ids: [rosterId], requested_count: 1, removed_count: 1 }, error: null })
  })
  afterEach(() => vi.unstubAllEnvs())
  it.each(['teacher', 'student'] as const)('uses trusted actor and one transaction for admitted %s', async role => {
    vi.mocked(requireAuth).mockResolvedValue(user(role))
    const response = await POST(request({ roster_ids: [rosterId, rosterId] }), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, requested_count: 1, removed_count: 1 })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('remove_classroom_students_for_owner_v1', { p_actor_id: actorId, p_classroom_id: classroomId, p_roster_ids: [rosterId] })
    expect(requireRole).not.toHaveBeenCalled()
    expect(assertTeacherCanMutateClassroom).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })
  it('authenticates before admission, params and body', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{')
    vi.mocked(requireAuth).mockRejectedValue(new AuthenticationError())
    const then = vi.fn(), req = request(), json = vi.spyOn(req, 'json')
    expect((await POST(req, { params: { then } as unknown as typeof context.params })).status).toBe(401)
    expect(then).not.toHaveBeenCalled()
    expect(json).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
  it('fails malformed admission before params and body', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{')
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    const then = vi.fn(), req = request(), json = vi.spyOn(req, 'json')
    expect((await POST(req, { params: { then } as unknown as typeof context.params })).status).toBe(503)
    expect(then).not.toHaveBeenCalled()
    expect(json).not.toHaveBeenCalled()
  })
  it('parses classroom UUID before reading body', async () => {
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    const req = request(), json = vi.spyOn(req, 'json')
    expect((await POST(req, { params: Promise.resolve({ id: 'bad' }) })).status).toBe(400)
    expect(json).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each([{ roster_ids: [] }, { roster_ids: ['bad'] }, { roster_ids: [rosterId], actorId }, { roster_ids: [rosterId], purge: true }])('rejects request %j', async body => {
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    expect((await POST(request(body), context)).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each(['42501', '22023', 'PT409', '40001', '40P01', '55P03', '55000', 'PT503', 'PGRST202'])('fails closed on %s without legacy fallback', async code => {
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    rpc.mockResolvedValue({ data: null, error: { code, message: 'private' } })
    const response = await POST(request(), context)
    expect(response.status).toBe(({ '42501': 403, '22023': 400, PT409: 409, '40001': 409, '40P01': 409, '55P03': 409, '55000': 409 } as Record<string, number>)[code] ?? 503)
    expect(await response.text()).not.toContain('private')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(from).not.toHaveBeenCalled()
    expect(requireRole).not.toHaveBeenCalled()
  })
  it.each([{ ids: [rosterId] }, { ids: [rosterId, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'] }])('reports duplicate identity conflict for one or all selected rows $ids', async ({ ids }) => {
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    const message = 'This student has multiple roster rows. Resolve the duplicate roster entries before removing them.'
    rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message } })
    const response = await POST(request({ roster_ids: ids }), context)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: message })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(from).not.toHaveBeenCalled()
    expect(requireRole).not.toHaveBeenCalled()
  })
  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [] })])('retains absent/unmatched legacy guard %s', async config => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    vi.mocked(requireRole).mockRejectedValue(new AuthorizationError())
    expect((await POST(request(), context)).status).toBe(403)
    expect(requireRole).toHaveBeenCalledWith('teacher')
    expect(rpc).not.toHaveBeenCalled()
    if (config === undefined) expect(requireAuth).not.toHaveBeenCalled()
  })
  it('retains the original teacher ownership and preserving164 RPC when disabled', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    vi.mocked(requireRole).mockResolvedValue(user('teacher'))
    vi.mocked(assertTeacherCanMutateClassroom).mockResolvedValue({ ok: true })
    rpc.mockResolvedValue({ data: { requested_count: 1, removed_count: 1 }, error: null })
    expect((await POST(request(), context)).status).toBe(200)
    expect(assertTeacherCanMutateClassroom).toHaveBeenCalledWith(actorId, classroomId)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('remove_classroom_students_preserving_data', { p_teacher_id: actorId, p_classroom_id: classroomId, p_roster_ids: [rosterId] })
  })
})

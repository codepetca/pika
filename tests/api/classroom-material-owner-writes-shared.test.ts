import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthenticationError, requireAuth, requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import { POST } from '@/app/api/teacher/classrooms/[id]/materials/route'
import { PATCH, DELETE } from '@/app/api/teacher/classrooms/[id]/materials/[materialId]/route'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/auth', async original => ({ ...await original<typeof import('@/lib/auth')>(), requireAuth: vi.fn(), requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classroom-access', () => ({ resolveClassroomAccess: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherCanMutateClassroom: vi.fn(), assertTeacherOwnsClassroom: vi.fn() }))
const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const materialId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const timestamp = '2026-10-03T12:00:00.123456+00:00'
const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '👩‍🏫 中文' }] }] }
const material = { id: materialId, classroom_id: classroomId, title: 'Reference', content, is_draft: true,
  released_at: null, created_by: actorId, created_at: timestamp, updated_at: timestamp, position: 0,
  artifact_id: materialId, source_artifact_id: null, blueprint_archived_at: null, source_blueprint_version_id: null }
const user = (role: 'student' | 'teacher') => ({ id: actorId, role, email: 'actor@example.test' } as AuthenticatedUser)
const context = () => ({ params: Promise.resolve({ id: classroomId, materialId }) })
const rpc = vi.fn()
const from = vi.fn()
const operations = [{ handler: POST, method: 'POST', body: { title: 'Reference', content }, rpcName: 'create_classwork_material_for_owner_v2', status: 201 },
  { handler: PATCH, method: 'PATCH', body: { title: 'Reference' }, rpcName: 'update_classwork_material_for_owner_v1', status: 200 },
  { handler: DELETE, method: 'DELETE', body: undefined, rpcName: 'delete_classwork_material_for_owner_v1', status: 200 }] as const
const request = (method: string, body?: unknown) => new NextRequest('http://localhost/api/teacher/materials', { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
function deferredParams() {
  const then = vi.fn()
  return { params: { then } as unknown as Promise<{ id: string; materialId: string }>, then }
}

describe('shared material owner write routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.stubEnv('PIKA_CLASSWORK_CREATION_CONTEXTUAL_ENABLED', 'false')
    vi.mocked(getServiceRoleClient).mockReturnValue({ rpc, from } as unknown as ReturnType<typeof getServiceRoleClient>)
    rpc.mockImplementation(async name => ({ data: name.startsWith('delete_')
      ? { deleted: true, actor_id: actorId, classroom_id: classroomId, material_id: materialId }
      : { actor_id: actorId, classroom_id: classroomId, material }, error: null }))
  })
  afterEach(() => vi.unstubAllEnvs())
  it.each(operations.flatMap(operation => ['teacher', 'student'].map(role => ({ ...operation, role: role as 'teacher' | 'student' }))))('lets admitted global $role use atomic $method', async ({ handler, method, body, rpcName, status, role }) => {
    vi.mocked(requireAuth).mockResolvedValue(user(role))
    const response = await handler(request(method, body), method === 'POST'
      ? { params: Promise.resolve({ id: classroomId }) } : context())
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual(method === 'DELETE' ? { success: true } : { material })
    expect(rpc).toHaveBeenCalledWith(rpcName, expect.objectContaining({ p_actor_id: actorId, p_classroom_id: classroomId }))
    expect(requireRole).not.toHaveBeenCalled()
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
    expect(assertTeacherCanMutateClassroom).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })
  it.each(operations)('authenticates before malformed admission, params, and $method body', async ({ handler, method }) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{')
    vi.mocked(requireAuth).mockRejectedValue(new AuthenticationError())
    const params = deferredParams()
    const req = request(method)
    const json = vi.spyOn(req, 'json')
    expect((await handler(req, { params: params.params })).status).toBe(401)
    expect(params.then).not.toHaveBeenCalled()
    expect(json).not.toHaveBeenCalled()
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
  it.each(operations)('rejects malformed admission before $method params/body', async ({ handler, method }) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{')
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    const params = deferredParams()
    expect((await handler(request(method), { params: params.params })).status).toBe(503)
    expect(params.then).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each(operations)('rejects malformed $method params before database access', async ({ handler, method, body }) => {
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    expect((await handler(request(method, body), { params: Promise.resolve({ id: 'bad', ...(method === 'POST' ? {} : { materialId }) }) })).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each(operations.flatMap(operation => ['42501', 'P0002', 'PT404', 'PT409', 'PT503', '55000', 'PGRST202'].map(code => ({ ...operation, code }))))('fails closed for $method $code without legacy fallback', async ({ handler, method, body, code }) => {
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    rpc.mockResolvedValue({ data: null, error: { code, message: 'private' } })
    const response = await handler(request(method, body), method === 'POST'
      ? { params: Promise.resolve({ id: classroomId }) } : context())
    expect(response.status).toBe(({ '42501': 403, P0002: 404, PT404: 404, PT409: 409, '55000': 409 } as Record<string, number>)[code] ?? 503)
    expect(await response.text()).not.toContain('private')
    expect(from).not.toHaveBeenCalled()
    expect(requireRole).not.toHaveBeenCalled()
  })
  it.each([{ title: 'ok', content, created_by: actorId }, { title: 'ok', content, is_draft: 'false' }, { title: 'ok', content: { type: 'doc', content: [{}] } }])('rejects strict POST input %j before RPC', async body => {
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    expect((await POST(request('POST', body), { params: Promise.resolve({ id: classroomId }) })).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each([{}, { title: '  ' }, { is_draft: 'false' }, { title: 'ok', released_at: timestamp }, { title: 'ok', source_blueprint_version_id: materialId }])('rejects strict PATCH input %j before RPC', async body => {
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    expect((await PATCH(request('PATCH', body), context())).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('DELETE does not read a body', async () => {
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    const req = request('DELETE', { created_by: materialId })
    const json = vi.spyOn(req, 'json')
    expect((await DELETE(req, context())).status).toBe(200)
    expect(json).not.toHaveBeenCalled()
  })
  it.each(operations.flatMap(operation => [undefined, JSON.stringify({ version: 1, admittedUserIds: [] })].map(config => ({ ...operation, config }))))('retains absent/unmatched $method role guard: $config', async ({ handler, method, body, config }) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    const { AuthorizationError } = await import('@/lib/auth')
    vi.mocked(requireRole).mockRejectedValue(new AuthorizationError())
    expect((await handler(request(method, body), context())).status).toBe(403)
    expect(requireRole).toHaveBeenCalledWith('teacher')
    expect(rpc).not.toHaveBeenCalled()
    if (config === undefined) expect(requireAuth).not.toHaveBeenCalled()
  })
})

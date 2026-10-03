import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthenticationError, requireAuth, requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertStudentCanAccessClassroom, assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import { GET as teacherGet } from '@/app/api/teacher/classrooms/[id]/materials/route'
import { GET as studentGet } from '@/app/api/student/classrooms/[id]/materials/route'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/auth', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/auth')>(), requireAuth: vi.fn(), requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classroom-access', () => ({ resolveClassroomAccess: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({ assertStudentCanAccessClassroom: vi.fn(), assertTeacherOwnsClassroom: vi.fn(), assertTeacherCanMutateClassroom: vi.fn() }))
const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const timestamp = '2026-10-03T12:00:00.123456+00:00'
const material = { id: otherId, classroom_id: classroomId, title: 'Reference', content: { type: 'doc', content: [] }, is_draft: false, released_at: null, created_by: otherId, created_at: timestamp, updated_at: timestamp, position: -1, artifact_id: null, source_artifact_id: null, blueprint_archived_at: timestamp, source_blueprint_version_id: null }
const user = (role: 'student' | 'teacher') => ({ id: actorId, role, email: 'actor@example.test' } as AuthenticatedUser)
const request = () => new NextRequest(`http://localhost/api/classrooms/${classroomId}/materials`)
const context = () => ({ params: Promise.resolve({ id: classroomId }) })
const routes = [{ handler: teacherGet, permission: 'owner', legacyRole: 'teacher' }, { handler: studentGet, permission: 'member', legacyRole: 'student' }] as const
const envelope = (data: unknown) => ({ data, error: null, count: null, status: 200, statusText: 'OK' })
function database(permission: 'owner' | 'member', pages?: unknown[]) {
  const classroom = { id: classroomId, teacher_id: permission === 'owner' ? actorId : otherId, archived_at: null }
  const root = (rows: unknown) => ({ ...classroom, materials: rows, ...(permission === 'member' ? { membership: [{ classroom_id: classroomId, student_id: actorId }] } : {}) })
  const results = pages ?? [envelope(root([material])), envelope(root([]))]
  let page = 0
  const from = vi.fn((table: string) => {
    let joined = false
    const builder = {
      select: vi.fn((fields: string) => { joined = fields.includes('materials:'); return builder }),
      eq: vi.fn(() => builder), neq: vi.fn(() => builder), is: vi.fn(() => builder), or: vi.fn(() => builder), order: vi.fn(() => builder), limit: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => joined ? results[page++] : table === 'classroom_enrollments' ? envelope({ classroom_id: classroomId, student_id: actorId }) : envelope(classroom)),
    }
    return builder
  })
  return { from }
}
function deferredParams() {
  const then = vi.fn()
  return { context: { params: { then } as unknown as Promise<{ id: string }> }, then }
}

describe('shared material GET admission', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.stubEnv('PIKA_CLASSROOM_MATERIALS_ACCESS_ENABLED', 'false')
    vi.mocked(assertTeacherOwnsClassroom).mockResolvedValue({ ok: true })
    vi.mocked(assertStudentCanAccessClassroom).mockResolvedValue({ ok: true })
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each(routes.flatMap(route => ['teacher', 'student'].map(role => ({ ...route, role: role as 'teacher' | 'student' }))))('returns full joined $permission materials for an admitted global $role', async ({ handler, permission, role }) => {
    vi.mocked(requireAuth).mockResolvedValue(user(role))
    const db = database(permission)
    vi.mocked(getServiceRoleClient).mockReturnValue(db as unknown as ReturnType<typeof getServiceRoleClient>)
    const response = await handler(request(), context())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ materials: [material] })
    expect(requireRole).not.toHaveBeenCalled()
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
    expect(assertTeacherOwnsClassroom).not.toHaveBeenCalled()
    expect(assertStudentCanAccessClassroom).not.toHaveBeenCalled()
    expect(db.from).not.toHaveBeenCalledWith('classwork_materials')
  })

  it.each(routes)('authenticates before malformed admission or unresolved $permission params', async ({ handler }) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{')
    vi.mocked(requireAuth).mockRejectedValue(new AuthenticationError())
    const params = deferredParams()
    expect((await handler(request(), params.context)).status).toBe(401)
    expect(params.then).not.toHaveBeenCalled()
    expect(getServiceRoleClient).not.toHaveBeenCalled()
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
  })

  it.each(routes.flatMap(route => ['', '{', JSON.stringify({ version: 2, admittedUserIds: [actorId] }), JSON.stringify({ version: 1, admittedUserIds: [actorId, actorId] })].map(config => ({ ...route, config }))))('fails malformed shared config before $permission params: $config', async ({ handler, config }) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
    vi.mocked(requireAuth).mockResolvedValue(user('teacher'))
    const params = deferredParams()
    expect((await handler(request(), params.context)).status).toBe(503)
    expect(params.then).not.toHaveBeenCalled()
    expect(getServiceRoleClient).not.toHaveBeenCalled()
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
  })

  it.each(routes)('validates admitted $permission UUIDs in the helper before querying', async ({ handler, permission }) => {
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    const db = database(permission)
    vi.mocked(getServiceRoleClient).mockReturnValue(db as unknown as ReturnType<typeof getServiceRoleClient>)
    expect((await handler(request(), { params: Promise.resolve({ id: 'bad' }) })).status).toBe(400)
    expect(db.from).not.toHaveBeenCalled()
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
  })

  it.each(routes)('never falls back when $permission relationship disappears at payload time', async ({ handler, permission }) => {
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    const db = database(permission, [envelope(null)])
    vi.mocked(getServiceRoleClient).mockReturnValue(db as unknown as ReturnType<typeof getServiceRoleClient>)
    expect((await handler(request(), context())).status).toBe(403)
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
    expect(db.from).not.toHaveBeenCalledWith('classwork_materials')
  })

  it.each(routes.flatMap(route => ['PGRST204', 'PGRST205'].map(code => ({ ...route, code }))))('rejects missing schema $code in shared $permission without compatibility fallback', async ({ handler, permission, code }) => {
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    const db = database(permission, [{ data: null, error: { code, message: 'private classwork_materials position' } }])
    vi.mocked(getServiceRoleClient).mockReturnValue(db as unknown as ReturnType<typeof getServiceRoleClient>)
    const response = await handler(request(), context())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Unable to verify classroom materials' })
    expect(db.from).not.toHaveBeenCalledWith('classwork_materials')
  })

  it.each(routes.flatMap(route => [undefined, JSON.stringify({ version: 1, admittedUserIds: [] })].map(config => ({ ...route, config }))))('preserves absent/unmatched $permission legacy missing-position and missing-table fallback: $config', async ({ handler, legacyRole, config }) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
    vi.mocked(requireAuth).mockResolvedValue(user(legacyRole))
    vi.mocked(requireRole).mockResolvedValue(user(legacyRole))
    const from = vi.fn()
    const first = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: { code: 'PGRST204', message: 'classwork_materials position' } }).then(resolve) }
    const fallback = { ...first, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: { code: 'PGRST205', message: 'classwork_materials' } }).then(resolve) }
    from.mockReturnValueOnce(first).mockReturnValueOnce(fallback)
    vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>)
    const response = await handler(request(), context())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ materials: [] })
    expect(from).toHaveBeenCalledTimes(2)
    expect(from).toHaveBeenCalledWith('classwork_materials')
    expect(resolveClassroomAccess).not.toHaveBeenCalled()
    if (config === undefined) expect(requireAuth).not.toHaveBeenCalled()
  })
})

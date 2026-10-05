import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { authorizeClassroomCoreRequest } from '@/lib/server/classroom-core-access'
import { fetchClassDaysForClassroom } from '@/lib/server/class-days'
import { GET as classroomGet } from '@/app/api/classrooms/[classroomId]/class-days/route'
import { GET as teacherGet } from '@/app/api/teacher/class-days/route'
import type { AuthenticatedUser } from '@/types'
import type { Database } from '@/types/database'

vi.mock('@/lib/auth', async original => ({ ...await original<typeof import('@/lib/auth')>(), requireAuth: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classroom-core-access', () => ({ authorizeClassroomCoreRequest: vi.fn() }))
vi.mock('@/lib/server/class-days', () => ({ fetchClassDaysForClassroom: vi.fn(), generateClassDaysForClassroom: vi.fn(), upsertClassDayForClassroom: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherOwnsClassroom: vi.fn(async () => ({ ok: true })), assertStudentCanAccessClassroom: vi.fn(async () => ({ ok: true })), assertTeacherCanMutateClassroom: vi.fn() }))

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const row = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', classroom_id: classroomId, date: '2026-10-03', is_class_day: true, prompt_text: null }
function call(family: 'classroom' | 'teacher', value = classroomId) {
  return family === 'classroom'
    ? classroomGet(new NextRequest('http://localhost/api/classrooms/class-days'), { params: Promise.resolve({ classroomId: value }) })
    : teacherGet(new NextRequest(`http://localhost/api/teacher/class-days?classroom_id=${encodeURIComponent(value)}`))
}
function sdk(owner: boolean, archived_at: string | null = null, overrides?: unknown[]) {
  const classroom = { id: classroomId, teacher_id: owner ? actorId : otherId, archived_at }
  const membership = { classroom_id: classroomId, student_id: actorId }
  const root = { ...classroom, ...(owner ? {} : { membership: [membership] }) }
  const responses = overrides ?? [classroom, ...(owner ? [] : [membership]), { ...root, class_days: [row] }, { ...root, class_days: [] }]
  const fetcher = vi.fn(async () => new Response(JSON.stringify(responses.shift()), { status: 200, headers: { 'content-type': 'application/json' } }))
  vi.mocked(getServiceRoleClient).mockReturnValue(createClient<Database>('http://127.0.0.1:54321', 'fake-key', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } }))
  return fetcher
}

describe.each(['classroom', 'teacher'] as const)('shared %s class-day GET', family => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'student' } as AuthenticatedUser)
    vi.mocked(authorizeClassroomCoreRequest).mockResolvedValue({ mode: 'legacy', user: { id: actorId, role: 'teacher' } as AuthenticatedUser })
    vi.mocked(fetchClassDaysForClassroom).mockResolvedValue({ classDays: [row], error: null })
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it.each(['teacher', 'student'] as const)('lets a %s-valued owner or member read', async role => {
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role } as AuthenticatedUser)
    for (const owner of [true, false]) {
      sdk(owner)
      const response = await call(family)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ class_days: [row] })
    }
    expect(authorizeClassroomCoreRequest).not.toHaveBeenCalled()
    expect(fetchClassDaysForClassroom).not.toHaveBeenCalled()
  })

  it('authenticates before malformed admission and before URL/params', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{bad')
    vi.mocked(requireAuth).mockRejectedValue(Object.assign(new Error('Unauthorized'), { name: 'AuthenticationError' }))
    const response = family === 'classroom'
      ? await classroomGet({} as NextRequest, { get params(): never { throw new Error('params accessed') } })
      : await teacherGet({ get url(): never { throw new Error('URL accessed') } } as unknown as NextRequest)
    expect(response.status).toBe(401)
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it('fails closed on malformed present admission and never falls back', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '')
    expect((await call(family)).status).toBe(503)
    expect(authorizeClassroomCoreRequest).not.toHaveBeenCalled()
  })

  it('authenticates before valid admission and before request input', async () => {
    vi.mocked(requireAuth).mockRejectedValue(Object.assign(new Error('Unauthorized'), { name: 'AuthenticationError' }))
    const response = family === 'classroom'
      ? await classroomGet({} as NextRequest, { get params(): never { throw new Error('params accessed') } })
      : await teacherGet({ get url(): never { throw new Error('URL accessed') } } as unknown as NextRequest)
    expect(response.status).toBe(401)
  })

  it('rejects malformed authenticated identity after auth and before request input', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: 'invalid', role: 'teacher' } as AuthenticatedUser)
    expect((await call(family, 'invalid')).status).toBe(503)
    expect(getServiceRoleClient).not.toHaveBeenCalled()
    expect(authorizeClassroomCoreRequest).not.toHaveBeenCalled()
  })

  it('rejects missing or extra shared request fields', async () => {
    const response = family === 'classroom'
      ? await classroomGet(new NextRequest('http://localhost/api/class-days'), { params: Promise.resolve({ classroomId, actorId }) })
      : await teacherGet(new NextRequest(`http://localhost/api/teacher/class-days?classroom_id=${classroomId}&actorId=${actorId}`))
    expect(response.status).toBe(400)
    const missing = family === 'classroom'
      ? await classroomGet(new NextRequest('http://localhost/api/class-days'), { params: Promise.resolve({}) })
      : await teacherGet(new NextRequest('http://localhost/api/teacher/class-days'))
    expect(missing.status).toBe(400)
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  if (family === 'teacher') it('rejects duplicate classroom query keys rather than choosing a value', async () => {
    const response = await teacherGet(new NextRequest(`http://localhost/api/teacher/class-days?classroom_id=${classroomId}&classroom_id=${classroomId}`))
    expect(response.status).toBe(400)
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it.each(['bad', classroomId.replaceAll('-', ''), `{${classroomId}}`])('rejects invalid shared UUID %s before query', async value => {
    expect((await call(family, value)).status).toBe(400)
    expect(getServiceRoleClient).not.toHaveBeenCalled()
    expect(authorizeClassroomCoreRequest).not.toHaveBeenCalled()
  })

  it('normalizes uppercase UUIDs and gives archived ownership precedence', async () => {
    sdk(true, '2026-10-03T12:00:00Z')
    expect((await call(family, classroomId.toUpperCase())).status).toBe(200)
  })

  it('denies archive, outsider, removed member and payload relationship loss', async () => {
    sdk(false, '2026-10-03T12:00:00Z')
    expect((await call(family)).status).toBe(403)
    sdk(false, null, [{ id: classroomId, teacher_id: otherId, archived_at: null }, null])
    expect((await call(family)).status).toBe(403)
    sdk(true, null, [{ id: classroomId, teacher_id: actorId, archived_at: null }, null])
    expect((await call(family)).status).toBe(403)
    expect(fetchClassDaysForClassroom).not.toHaveBeenCalled()
    expect(authorizeClassroomCoreRequest).not.toHaveBeenCalled()
  })

  it('maps missing classes to 404 and malformed evidence to 503', async () => {
    sdk(true, null, [null])
    expect((await call(family)).status).toBe(404)
    sdk(true, null, [{ id: classroomId, teacher_id: actorId, archived_at: null }, { id: classroomId, teacher_id: actorId, archived_at: null, class_days: null }])
    expect((await call(family)).status).toBe(503)
    expect(fetchClassDaysForClassroom).not.toHaveBeenCalled()
  })

  it.each(['absent', 'unmatched'] as const)('retains the entire existing branch for %s admission', async admission => {
    if (admission === 'absent') vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    else vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [otherId] }))
    const response = await call(family, 'legacy-id')
    expect(response.status).toBe(200)
    expect(authorizeClassroomCoreRequest).toHaveBeenCalledWith('legacy-id', { permission: 'read' })
    expect(fetchClassDaysForClassroom).toHaveBeenCalledWith('legacy-id')
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })
})

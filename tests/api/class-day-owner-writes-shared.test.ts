import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { requireAuth, requireRole, AuthorizationError } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { authorizeClassroomCoreRequest } from '@/lib/server/classroom-core-access'
import { generateClassDaysForClassroom, upsertClassDayForClassroom } from '@/lib/server/class-days'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { POST, PATCH } from '@/app/api/classrooms/[classroomId]/class-days/route'
import { POST as teacherPost, PATCH as teacherPatch } from '@/app/api/teacher/class-days/route'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/auth', async original => ({ ...await original<typeof import('@/lib/auth')>(), requireAuth: vi.fn(), requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classroom-core-access', async original => ({ ...await original<typeof import('@/lib/server/classroom-core-access')>(), authorizeClassroomCoreRequest: vi.fn((...args) => original<typeof import('@/lib/server/classroom-core-access')>().then(module => module.authorizeClassroomCoreRequest(...args))) }))
vi.mock('@/lib/server/class-days', () => ({ fetchClassDaysForClassroom: vi.fn(), generateClassDaysForClassroom: vi.fn(), upsertClassDayForClassroom: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherCanMutateClassroom: vi.fn(), assertTeacherOwnsClassroom: vi.fn(), assertStudentCanAccessClassroom: vi.fn() }))
vi.mock('@/lib/timezone', () => ({ getTodayInToronto: () => '2026-10-05' }))
const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const day = { id: otherId, classroom_id: classroomId, date: '2026-10-05', is_class_day: true, prompt_text: null }
const nextDay = { ...day, id: actorId, date: '2026-10-06' }
const rpc = vi.fn()
const from = vi.fn()
const envelope = (data: unknown) => ({ data, error: null, count: null, status: 200, statusText: 'OK' })
const endpoints = [
  { name: 'classroom POST', handler: POST, compatibility: false, creating: true },
  { name: 'classroom PATCH', handler: PATCH, compatibility: false, creating: false },
  { name: 'teacher POST', handler: teacherPost, compatibility: true, creating: true },
  { name: 'teacher PATCH', handler: teacherPatch, compatibility: true, creating: false },
]
describe.each(endpoints)('$name shared owner calendar writes', endpoint => {
  const input = () => endpoint.creating ? { start_date: '2026-10-05', end_date: '2026-10-06' } : { date: '2026-10-05', is_class_day: true }
  const call = (body: unknown = input(), id = classroomId) => endpoint.handler(new NextRequest('http://localhost/api/class-days', {
    method: endpoint.creating ? 'POST' : 'PATCH', body: typeof body === 'string' ? body : JSON.stringify({ classroom_id: id, ...body as object }),
  }), { params: Promise.resolve({ classroomId: id }) })
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_ENABLED', 'false')
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'student' } as AuthenticatedUser)
    vi.mocked(requireRole).mockRejectedValue(new AuthorizationError('Forbidden'))
    vi.mocked(assertTeacherCanMutateClassroom).mockResolvedValue({ ok: true })
    vi.mocked(generateClassDaysForClassroom).mockResolvedValue({ ok: true, count: 1, classDays: [day] })
    vi.mocked(upsertClassDayForClassroom).mockResolvedValue({ ok: true, classDay: day })
    rpc.mockResolvedValue(envelope(endpoint.creating ? [day, nextDay] : [day]))
    vi.mocked(getServiceRoleClient).mockReturnValue({ rpc, from } as unknown as ReturnType<typeof getServiceRoleClient>)
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it.each(['teacher', 'student'] as const)('admits a %s-valued owner using only trusted actor/RPC arguments', async role => {
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role } as AuthenticatedUser)
    const response = await call({ ...input(), actor_id: otherId, teacher_id: otherId, p_actor_id: otherId, dates: ['1999-01-01'], p_dates: ['1999-01-01'], plan: 'pro' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(endpoint.creating ? { success: true, count: 2, class_days: [day, nextDay] } : { class_day: day })
    expect(rpc).toHaveBeenCalledExactlyOnceWith(endpoint.creating ? 'create_classroom_calendar_v1' : 'set_classroom_calendar_day_v1', endpoint.creating
      ? { p_actor_id: actorId, p_classroom_id: classroomId, p_start_date: '2026-10-05', p_end_date: '2026-10-06', p_dates: ['2026-10-05', '2026-10-06'] }
      : { p_actor_id: actorId, p_classroom_id: classroomId, p_date: '2026-10-05', p_is_class_day: true })
    expect(from).not.toHaveBeenCalled()
    expect(requireRole).not.toHaveBeenCalled()
    expect(authorizeClassroomCoreRequest).not.toHaveBeenCalled()
    expect(generateClassDaysForClassroom).not.toHaveBeenCalled()
    expect(upsertClassDayForClassroom).not.toHaveBeenCalled()
  })

  it.each(['valid', 'malformed'])('authenticates before %s admission/params/body', async config => {
    if (config === 'malformed') vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{')
    vi.mocked(requireAuth).mockRejectedValue(Object.assign(new Error('Unauthorized'), { name: 'AuthenticationError' }))
    const json = vi.fn(async () => { throw new Error('body accessed') })
    const response = await endpoint.handler({ json } as unknown as NextRequest, { get params(): never { throw new Error('params accessed') } })
    expect(response.status).toBe(401)
    expect(json).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('fails closed before body/params on malformed present configuration or actor', async () => {
    const json = vi.fn()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '')
    expect((await endpoint.handler({ json } as unknown as NextRequest, { get params(): never { throw new Error('params accessed') } })).status).toBe(503)
    expect(json).not.toHaveBeenCalled()
    expect(authorizeClassroomCoreRequest).not.toHaveBeenCalled()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.mocked(requireAuth).mockResolvedValue({ id: 'bad', role: 'teacher' } as AuthenticatedUser)
    expect((await call()).status).toBe(503)
  })

  it.each(['member', 'outsider', 'archived owner'])('denies %s from the RPC152 current owner/archive check', async () => {
    rpc.mockResolvedValue({ ...envelope(null), error: { code: '42501', message: 'private detail', details: null, hint: null }, status: 403 })
    const response = await call()
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(generateClassDaysForClassroom).not.toHaveBeenCalled()
    expect(upsertClassDayForClassroom).not.toHaveBeenCalled()
  })

  it.each(['P0002', '22023', '23505', 'PGRST202', 'XX000'])('maps installed RPC error %s with no raw error/fallback', async code => {
    rpc.mockResolvedValue({ ...envelope(null), error: { code, message: 'private detail', details: null, hint: null }, status: 400 })
    const response = await call()
    expect(response.status).toBe(code === 'P0002' ? 404 : code === '22023' ? 400 : code === '23505' && endpoint.creating ? 409 : 503)
    expect(JSON.stringify(await response.json())).not.toContain('private detail')
    expect(authorizeClassroomCoreRequest).not.toHaveBeenCalled()
    expect(generateClassDaysForClassroom).not.toHaveBeenCalled()
    expect(upsertClassDayForClassroom).not.toHaveBeenCalled()
  })

  it.each(['{', {}, { start_date: '2026-02-30', end_date: '2026-03-02', date: '2026-02-30', is_class_day: 'true' }])('rejects malformed operation input %#', async body => {
    expect((await call(body)).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each(['bad', classroomId.replaceAll('-', ''), `{${classroomId}}`])('rejects canonical identity aliases %#', async id => {
    expect((await call(input(), id)).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
    expect(authorizeClassroomCoreRequest).not.toHaveBeenCalled()
  })

  it('normalizes UUIDs and reads the compatibility JSON once after auth', async () => {
    const json = vi.fn(async () => ({ classroom_id: classroomId.toUpperCase(), ...input() }))
    const response = await endpoint.handler({ json } as unknown as NextRequest, { params: Promise.resolve({ classroomId: classroomId.toUpperCase() }) })
    expect(response.status).toBe(200)
    expect(json).toHaveBeenCalledTimes(1)
    expect(requireAuth.mock.invocationCallOrder[0]).toBeLessThan(json.mock.invocationCallOrder[0])
    expect(rpc.mock.calls[0][1].p_classroom_id).toBe(classroomId)
  })

  it.each([{ data: null }, { data: null, error: false }, envelope(null), envelope([{ ...day, classroom_id: otherId }]), envelope([day, day])])('rejects malformed/foreign/duplicate wire response %#', async response => {
    rpc.mockResolvedValue(response)
    expect((await call()).status).toBe(503)
    expect(authorizeClassroomCoreRequest).not.toHaveBeenCalled()
  })

  it.each(['absent', 'unmatched'])('preserves full existing teacher writer and auth/JSON call counts when %s', async admission => {
    if (admission === 'absent') vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    else vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [otherId] }))
    vi.mocked(requireRole).mockResolvedValue({ id: actorId, role: 'teacher' } as AuthenticatedUser)
    const json = vi.fn(async () => ({ classroom_id: classroomId, ...input() }))
    const response = await endpoint.handler({ json } as unknown as NextRequest, { params: Promise.resolve({ classroomId }) })
    expect(response.status).toBe(200)
    expect(json).toHaveBeenCalledTimes(1)
    expect(requireRole).toHaveBeenCalledExactlyOnceWith('teacher')
    expect(requireAuth).toHaveBeenCalledTimes(admission === 'absent' ? 0 : 1)
    expect(authorizeClassroomCoreRequest).toHaveBeenCalledTimes(1)
    expect(assertTeacherCanMutateClassroom).toHaveBeenCalledWith(actorId, classroomId)
    expect(endpoint.creating ? generateClassDaysForClassroom : upsertClassDayForClassroom).toHaveBeenCalledTimes(1)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each(['absent', 'unmatched'])('preserves role denial before body parsing when %s', async admission => {
    if (admission === 'absent') vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    else vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [otherId] }))
    const json = vi.fn(async () => { throw new Error('body accessed') })
    const response = await endpoint.handler({ json } as unknown as NextRequest, { params: Promise.resolve({ classroomId }) })
    expect(response.status).toBe(403)
    expect(json).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})

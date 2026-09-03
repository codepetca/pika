import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { requireAuth, requireRole, AuthorizationError } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { POST, PATCH } from '@/app/api/classrooms/[classroomId]/class-days/route'
import { POST as legacyPost, PATCH as legacyPatch } from '@/app/api/teacher/class-days/route'
import { generateClassDaysForClassroom, upsertClassDayForClassroom } from '@/lib/server/class-days'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/auth', async (original) => ({ ...await original<typeof import('@/lib/auth')>(), requireAuth: vi.fn(), requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/class-days', () => ({ fetchClassDaysForClassroom: vi.fn(), generateClassDaysForClassroom: vi.fn(), upsertClassDayForClassroom: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherCanMutateClassroom: vi.fn(), assertTeacherOwnsClassroom: vi.fn(), assertStudentCanAccessClassroom: vi.fn() }))
vi.mock('@/lib/timezone', () => ({ getTodayInToronto: () => '2026-09-01' }))
const actor = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const row = { id: other, classroom_id: classroomId, date: '2026-09-08', is_class_day: true, prompt_text: null }
const rpc = vi.fn()
const from = vi.fn()
let classroom: { id: string; teacher_id: string; archived_at: string | null } | null
let readError: unknown
let enrolled: boolean
const endpoints = [
  { name: 'canonical POST', handler: POST, method: 'POST', body: { start_date: '2026-09-07', end_date: '2026-09-08' }, rpcName: 'create_classroom_calendar_v1' },
  { name: 'legacy POST', handler: legacyPost, method: 'POST', body: { start_date: '2026-09-07', end_date: '2026-09-08' }, rpcName: 'create_classroom_calendar_v1' },
  { name: 'canonical PATCH', handler: PATCH, method: 'PATCH', body: { date: '2026-09-08', is_class_day: true }, rpcName: 'set_classroom_calendar_day_v1' },
  { name: 'legacy PATCH', handler: legacyPatch, method: 'PATCH', body: { date: '2026-09-08', is_class_day: true }, rpcName: 'set_classroom_calendar_day_v1' },
]

describe.each(endpoints)('$name contextual pilot', (endpoint) => {
  const call = (body: unknown = endpoint.body, id = classroomId) => endpoint.handler(
    new NextRequest(`http://localhost/api/classrooms/${id}/class-days`, {
      method: endpoint.method,
      body: typeof body === 'string' ? body : JSON.stringify({ classroom_id: id, ...body as object }),
    }), { params: Promise.resolve({ classroomId: id }) })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_PAIRS', JSON.stringify([{ userId: actor, classroomId }]))
    vi.mocked(requireAuth).mockResolvedValue({ id: actor, role: 'student' } as AuthenticatedUser)
    vi.mocked(requireRole).mockRejectedValue(new AuthorizationError('Forbidden'))
    vi.mocked(assertTeacherCanMutateClassroom).mockResolvedValue({ ok: true })
    vi.mocked(generateClassDaysForClassroom).mockResolvedValue({ ok: true, count: 1, classDays: [row] })
    vi.mocked(upsertClassDayForClassroom).mockResolvedValue({ ok: true, classDay: row })
    classroom = { id: classroomId, teacher_id: actor, archived_at: null }
    readError = null
    enrolled = false
    from.mockImplementation((table) => {
      const builder = {
        select: vi.fn(() => builder), eq: vi.fn(() => builder),
        maybeSingle: vi.fn(async () => ({ data: table === 'classrooms' ? classroom : enrolled ? { classroom_id: classroomId, student_id: actor } : null, error: readError })),
      }
      return builder
    })
    rpc.mockResolvedValue({ data: [row], error: null })
    vi.mocked(getServiceRoleClient).mockReturnValue({ from, rpc } as unknown as ReturnType<typeof getServiceRoleClient>)
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it('admits a student-valued owner and strips client actor/plan/date-array claims', async () => {
    const response = await call({ ...endpoint.body, actor_id: other, teacher_id: other, plan: 'pro', dates: ['1999-01-01'] })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(endpoint.method === 'POST' ? { success: true, count: 1, class_days: [row] } : { class_day: row })
    expect(rpc).toHaveBeenCalledWith(endpoint.rpcName, expect.objectContaining({ p_actor_id: actor, p_classroom_id: classroomId }))
    expect(requireRole).not.toHaveBeenCalled()
    expect(generateClassDaysForClassroom).not.toHaveBeenCalled()
    expect(upsertClassDayForClassroom).not.toHaveBeenCalled()
  })
  it('authenticates before malformed JSON or classroom reads', async () => {
    vi.mocked(requireAuth).mockRejectedValue(Object.assign(new Error(), { name: 'AuthenticationError' }))
    expect((await call('{')).status).toBe(401)
    expect(from).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
  it('also admits a teacher-valued pilot owner', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: actor, role: 'teacher' } as AuthenticatedUser)
    expect((await call()).status).toBe(200)
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('does not admit an allowed actor for a different classroom', async () => {
    const response = await call(endpoint.body, other)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
    expect(rpc).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })
  it.each([false, true])('rejects a nonowner, enrolled=%s', async (member) => {
    classroom!.teacher_id = other
    enrolled = member
    expect((await call()).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('rejects an archived owner without calling the writer', async () => {
    classroom!.archived_at = '2026-09-01T00:00:00Z'
    expect((await call()).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each([null, { code: 'XX000' }])('fails closed on missing classroom or read error %j', async (error) => {
    classroom = null
    readError = error
    expect((await call()).status).toBe(error ? 503 : 404)
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each(['PGRST202', '42501', '22023'])('does not retry/fall back after RPC %s', async (code) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'private detail' } })
    const response = await call()
    expect(response.status).toBe(code === '42501' ? 403 : code === '22023' ? 400 : 503)
    expect(JSON.stringify(await response.json())).not.toContain('private detail')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(generateClassDaysForClassroom).not.toHaveBeenCalled()
    expect(upsertClassDayForClassroom).not.toHaveBeenCalled()
  })
  it.each(['{', {}, { date: '2026-02-30', is_class_day: 'true' }, { start_date: '2026-02-30', end_date: '2026-03-01' }])('rejects malformed inputs %j', async (body) => {
    expect((await call(body)).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('rejects invalid RPC response evidence', async () => {
    rpc.mockResolvedValue({ data: [{ ...row, classroom_id: other }], error: null })
    expect((await call()).status).toBe(503)
  })
  it('normalizes uppercase classroom UUIDs without falling back', async () => {
    expect((await call(endpoint.body, classroomId.toUpperCase())).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith(endpoint.rpcName, expect.objectContaining({ p_classroom_id: classroomId }))
  })
  it.each([classroomId.replaceAll('-', ''), `{${classroomId}}`])('rejects alternate UUID %s', async (id) => {
    expect((await call(endpoint.body, id)).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })
  it('fails closed on malformed pilot configuration', async () => {
    vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_PAIRS', '{')
    expect((await call()).status).toBe(503)
    expect(rpc).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })
  it.each(['disabled', 'unmatched'])('retains the original teacher writer when %s', async (mode) => {
    if (mode === 'disabled') vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_ENABLED', 'false')
    else vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_PAIRS', '[]')
    const user = { id: actor, role: 'teacher' } as AuthenticatedUser
    vi.mocked(requireAuth).mockResolvedValue(user)
    vi.mocked(requireRole).mockResolvedValue(user)
    expect((await call()).status).toBe(200)
    expect(assertTeacherCanMutateClassroom).toHaveBeenCalledWith(actor, classroomId)
    expect(endpoint.method === 'POST' ? generateClassDaysForClassroom : upsertClassDayForClassroom).toHaveBeenCalledTimes(1)
    expect(rpc).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })
  it.each(['disabled', 'unmatched'])('preserves Forbidden before malformed JSON for nonpilot student when %s', async (mode) => {
    if (mode === 'disabled') vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_ENABLED', 'false')
    else vi.stubEnv('PIKA_CLASSROOM_CORE_ACCESS_PAIRS', '[]')
    const response = await call('{')
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

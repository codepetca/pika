import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthenticationError, AuthorizationError, requireAuth, requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { readContextualAnnouncements } from '@/lib/server/contextual-announcement-read'
import { GET, POST } from '@/app/api/student/classrooms/[id]/announcements/route'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/auth', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/auth')>(), requireAuth: vi.fn(), requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({ assertStudentCanAccessClassroom: vi.fn() }))
vi.mock('@/lib/server/contextual-announcement-read', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server/contextual-announcement-read')>(),
  readContextualAnnouncements: vi.fn(),
}))

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const announcementId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const timestamp = '2026-10-03T12:00:00.000Z'
const rpc = vi.fn()
const from = vi.fn()
const user = (role: 'student' | 'teacher') => ({ id: actorId, role, email: 'actor@example.test' } as AuthenticatedUser)
const success = () => ({ data: { actor_id: actorId, classroom_id: classroomId, marked: 2, inserted: 1 }, error: null })
function request(body?: string) {
  return new NextRequest(`http://localhost/api/student/classrooms/${classroomId}/announcements`, {
    method: 'POST', ...(body === undefined ? {} : { body }),
  })
}
function deferredParams(id = classroomId) {
  const then = vi.fn((resolve: (value: { id: string }) => unknown) => Promise.resolve(resolve({ id })))
  return { context: { params: { then } as unknown as Promise<{ id: string }> }, then }
}
const context = () => ({ params: Promise.resolve({ id: classroomId }) })

describe('shared-admission member announcement receipts', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(timestamp))
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.stubEnv('PIKA_CLASSROOM_ANNOUNCEMENTS_ACCESS_ENABLED', undefined)
    vi.stubEnv('PIKA_CLASSROOM_ANNOUNCEMENTS_ACCESS_PAIRS', undefined)
    vi.mocked(requireAuth).mockResolvedValue(user('teacher'))
    vi.mocked(requireRole).mockResolvedValue(user('student'))
    vi.mocked(assertStudentCanAccessClassroom).mockResolvedValue({ ok: true })
    vi.mocked(getServiceRoleClient).mockReturnValue({ rpc, from } as unknown as ReturnType<typeof getServiceRoleClient>)
    rpc.mockResolvedValue(success())
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it.each(['teacher', 'student'] as const)('sends an admitted global %s to the member RPC and exposes only the existing public result', async role => {
    vi.mocked(requireAuth).mockResolvedValue(user(role))
    const response = await POST(request(), context())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, marked: 2 })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('mark_announcements_read_for_member_v1', {
      p_actor_id: actorId, p_classroom_id: classroomId, p_cutoff: timestamp,
    })
    expect(requireRole).not.toHaveBeenCalled()
    expect(assertStudentCanAccessClassroom).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it.each([undefined, '{', JSON.stringify({ actor_id: announcementId, classroom_id: announcementId, cutoff: '2099-01-01', announcementIds: [announcementId] })])('ignores POST body authority and retains body-less requests: %s', async body => {
    const req = request(body)
    const json = vi.spyOn(req, 'json')
    expect((await POST(req, context())).status).toBe(200)
    expect(json).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('mark_announcements_read_for_member_v1', {
      p_actor_id: actorId, p_classroom_id: classroomId, p_cutoff: timestamp,
    })
  })

  it.each([undefined, '{', JSON.stringify({ version: 1, admittedUserIds: [actorId] })])('authenticates before params, admission parsing, body or SDK for config %s', async config => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
    vi.mocked(requireAuth).mockRejectedValue(new AuthenticationError())
    vi.mocked(requireRole).mockRejectedValue(new AuthenticationError())
    const params = deferredParams('bad')
    const req = request('{')
    const json = vi.spyOn(req, 'json')
    const response = await POST(req, params.context)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(params.then).not.toHaveBeenCalled()
    expect(json).not.toHaveBeenCalled()
    expect(getServiceRoleClient).not.toHaveBeenCalled()
    expect(assertStudentCanAccessClassroom).not.toHaveBeenCalled()
  })

  it.each(['', '{', 'null', JSON.stringify({ version: 2, admittedUserIds: [actorId] }), JSON.stringify({ version: 1, admittedUserIds: [actorId, actorId] }), JSON.stringify({ version: 1, admittedUserIds: ['bad'] }), JSON.stringify({ version: 1, admittedUserIds: [actorId], extra: true })])('fails closed on present malformed admission %s', async config => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
    const params = deferredParams('bad')
    const req = request('{')
    const json = vi.spyOn(req, 'json')
    expect((await POST(req, params.context)).status).toBe(503)
    expect(params.then).not.toHaveBeenCalled()
    expect(json).not.toHaveBeenCalled()
    expect(requireAuth).toHaveBeenCalledTimes(1)
    expect(requireRole).not.toHaveBeenCalled()
    expect(getServiceRoleClient).not.toHaveBeenCalled()
  })

  it('rejects an invalid admitted classroom before any SDK work or body read', async () => {
    const req = request('{')
    const json = vi.spyOn(req, 'json')
    expect((await POST(req, deferredParams('bad').context)).status).toBe(400)
    expect(json).not.toHaveBeenCalled()
    expect(getServiceRoleClient).not.toHaveBeenCalled()
    expect(requireRole).not.toHaveBeenCalled()
  })

  it.each([
    ['42501', 403], ['P0002', 404], ['22023', 400], ['PT409', 409], ['PGRST202', 503], ['XX000', 503],
  ] as const)('maps transaction-time member/class/fence result %s to %s without legacy fallback', async (code, status) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'private receipt details', details: null, hint: null } })
    const response = await POST(request(), context())
    expect(response.status).toBe(status)
    expect(JSON.stringify(await response.json())).not.toContain('private receipt details')
    expect(requireRole).not.toHaveBeenCalled()
    expect(assertStudentCanAccessClassroom).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it.each([null, {}, { data: null, error: null }, { data: { ...success().data, actor_id: announcementId }, error: null }])('rejects malformed or substituted output without fallback %#', async result => {
    rpc.mockResolvedValue(result)
    expect((await POST(request(), context())).status).toBe(503)
    expect(requireRole).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it('returns zero when the transaction proves no eligible announcements', async () => {
    rpc.mockResolvedValue({ data: { actor_id: actorId, classroom_id: classroomId, marked: 0, inserted: 0 }, error: null })
    const response = await POST(request(), context())
    expect(await response.json()).toEqual({ success: true, marked: 0 })
  })

  it('fails closed on transport exceptions without legacy fallback', async () => {
    rpc.mockRejectedValue(new Error('private transport details'))
    const response = await POST(request(), context())
    expect(response.status).toBe(503)
    expect(requireRole).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [] })])('retains the legacy global-student guard for absent/unmatched admission %s', async config => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
    vi.mocked(requireRole).mockRejectedValue(new AuthorizationError())
    const params = deferredParams('bad')
    const response = await POST(request(), params.context)
    expect(response.status).toBe(403)
    expect(requireRole).toHaveBeenCalledWith('student')
    expect(params.then).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    if (config === undefined) expect(requireAuth).not.toHaveBeenCalled()
  })

  it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [] })])('preserves the legacy body-less SDK receipt flow for admission %s', async config => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), or: vi.fn().mockResolvedValue({ data: [{ id: announcementId }], error: null }) }
    const upsert = vi.fn().mockResolvedValue({ error: null })
    from.mockImplementation(table => table === 'announcements' ? query : { upsert })
    const req = request('{')
    const json = vi.spyOn(req, 'json')
    const response = await POST(req, context())
    expect(await response.json()).toEqual({ success: true, marked: 1 })
    expect(assertStudentCanAccessClassroom).toHaveBeenCalledWith(actorId, classroomId)
    expect(upsert).toHaveBeenCalledWith([{ announcement_id: announcementId, user_id: actorId }], { onConflict: 'announcement_id,user_id', ignoreDuplicates: true })
    expect(query.eq).toHaveBeenCalledWith('is_draft', false)
    expect(query.or).toHaveBeenCalledWith('scheduled_for.is.null,scheduled_for.lte.now()')
    expect(json).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('keeps the announcement exact-pair read gate out of legacy receipt mutation admission', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    vi.stubEnv('PIKA_CLASSROOM_ANNOUNCEMENTS_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_ANNOUNCEMENTS_ACCESS_PAIRS', JSON.stringify([{ userId: actorId, classroomId }]))
    vi.mocked(requireRole).mockRejectedValue(new AuthorizationError())
    expect((await POST(request(), context())).status).toBe(403)
    expect(requireRole).toHaveBeenCalledWith('student')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('leaves shared GET on the existing contextual member-read helper', async () => {
    vi.mocked(readContextualAnnouncements).mockResolvedValue({ announcements: [] })
    const response = await GET(new NextRequest('http://localhost/api/announcements'), context())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ announcements: [] })
    expect(readContextualAnnouncements).toHaveBeenCalledWith({ supabase: expect.anything(), actorId, classroomId, permission: 'member' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

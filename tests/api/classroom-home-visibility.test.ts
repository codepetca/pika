import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/classrooms/home/[classroomId]/visibility/route'
import { requireAuth } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const enrollmentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const rpc = vi.fn()
const success = (hidden = true) => ({
  data: { actor_id: actorId, classroom_id: classroomId, enrollment_id: enrollmentId, hidden },
  error: null, status: 200, statusText: 'OK', count: null,
})
function invoke(body: unknown = { enrollmentId, hidden: true }, id = classroomId) {
  return PATCH(new NextRequest(`http://localhost/api/classrooms/home/${id}/visibility`, {
    method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  }), { params: Promise.resolve({ classroomId: id }) })
}
describe('personal classroom home visibility API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_ENABLED', 'true')
    vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_USER_IDS', JSON.stringify([actorId]))
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'student', email: 'test@example.test' })
    rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue(success()) })
    vi.mocked(getServiceRoleClient).mockReturnValue({ rpc } as never)
  })
  afterEach(() => vi.unstubAllEnvs())
  it.each(['student', 'teacher'] as const)('binds the authenticated %s actor and exact current enrollment', async role => {
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role, email: 'test@example.test' })
    const response = await invoke()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(success().data)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('set_classroom_home_visibility_v1', {
      p_actor_id: actorId, p_classroom_id: classroomId, p_expected_enrollment_id: enrollmentId, p_hidden: true,
    })
  })
  it.each([{ hidden: true }, { enrollmentId, hidden: 'true' }, { enrollmentId, hidden: true, actorId }, { enrollmentId: 'bad', hidden: true }])('rejects untrusted or incomplete input %j before SQL', async body => {
    expect((await invoke(body)).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('rejects malformed classroom identity before SQL', async () => {
    expect((await invoke(undefined, 'invalid')).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each(['home-disabled', 'home-unmatched', 'experience-unmatched', 'experience-absent'])('keeps %s callers off the new mutation', async mode => {
    if (mode === 'home-disabled') vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_ENABLED', 'false')
    if (mode === 'home-unmatched') vi.stubEnv('PIKA_CLASSROOM_HOME_ACCESS_USER_IDS', '[]')
    if (mode === 'experience-unmatched') vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{"version":1,"admittedUserIds":[]}')
    if (mode === 'experience-absent') vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    expect((await invoke()).status).toBe(404)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('fails closed on malformed complete-experience admission', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{}')
    expect((await invoke()).status).toBe(503)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('does not report success for a stale or rebound SQL reply', async () => {
    rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ ...success(), data: { ...success().data, enrollment_id: classroomId } }) })
    expect((await invoke()).status).toBe(503)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/classrooms/[id]/lesson-plans/copy/route'
import { AuthenticationError, requireAuth, requireRole } from '@/lib/auth'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import { getServiceRoleClient } from '@/lib/supabase'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/auth', async (original) => ({
  ...await original<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(), requireRole: vi.fn(),
}))
vi.mock('@/lib/server/classroom-access', () => ({ resolveClassroomAccess: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherCanMutateClassroom: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const fromDate = '2026-09-19'
const toDate = '2026-09-20'
const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Copy me' }] }] }
const row = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', classroom_id: classroomId, date: toDate,
  content, content_markdown: null,
  artifact_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  source_artifact_id: null, source_blueprint_version_id: null, blueprint_archived_at: null,
  created_at: '2026-09-19T12:00:00+00:00', updated_at: '2026-09-20T12:00:00+00:00',
}
const params = { params: Promise.resolve({ id: classroomId }) }
const request = (body: unknown) => new NextRequest(`http://localhost/api/teacher/classrooms/${classroomId}/lesson-plans/copy`, {
  method: 'POST', body: JSON.stringify(body),
})
const validBody = { fromDate, toDate }
const rpc = vi.fn()

describe('shared-admission lesson-plan copy', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'student' } as AuthenticatedUser)
    vi.mocked(resolveClassroomAccess).mockResolvedValue({
      userId: actorId, classroomId, ownerId: actorId, relationship: 'owner', archived: false,
    })
    vi.mocked(getServiceRoleClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof getServiceRoleClient>)
    rpc.mockResolvedValue({ data: { lesson_plan: row }, error: null })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('copies through one actor-bound RPC and preserves raw nullable markdown', async () => {
    const response = await POST(request(validBody), params)
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ lesson_plan: row })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('copy_lesson_plan_for_owner_v1', {
      p_actor_id: actorId, p_classroom_id: classroomId,
      p_from_date: fromDate, p_to_date: toDate,
    })
    expect(requireRole).not.toHaveBeenCalled()
    expect(vi.mocked(getServiceRoleClient).mock.results[0]?.value.from).toBeUndefined()
  })

  it('authenticates before reading params and preflights owner before reading body', async () => {
    vi.mocked(requireAuth).mockRejectedValueOnce(new AuthenticationError())
    const then = vi.fn()
    const response = await POST(request(validBody), { params: { then } as unknown as Promise<{ id: string }> })
    expect(response.status).toBe(401)
    expect(then).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()

    vi.mocked(resolveClassroomAccess).mockResolvedValueOnce({
      userId: actorId, classroomId, ownerId: actorId, relationship: 'enrolled', archived: false,
    })
    const unread = new NextRequest('http://localhost/api/teacher/classrooms/a/lesson-plans/copy', { method: 'POST', body: '{' })
    expect((await POST(unread, params)).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('accepts an admitted teacher owner who is also enrolled', async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce({ id: actorId, role: 'teacher' } as AuthenticatedUser)
    vi.mocked(resolveClassroomAccess).mockResolvedValueOnce({
      userId: actorId, classroomId, ownerId: actorId, relationship: 'owner', archived: false, isEnrolled: true,
    } as Awaited<ReturnType<typeof resolveClassroomAccess>>)
    expect((await POST(request(validBody), params)).status).toBe(201)
  })

  it.each([null, { userId: actorId, classroomId, ownerId: actorId, relationship: 'owner', archived: true }])(
    'rejects missing or archived classroom before invoking RPC', async (scope) => {
      vi.mocked(resolveClassroomAccess).mockResolvedValueOnce(scope as Awaited<ReturnType<typeof resolveClassroomAccess>>)
      expect((await POST(request(validBody), params)).status).toBe(scope === null ? 404 : 403)
      expect(rpc).not.toHaveBeenCalled()
    },
  )

  it('rejects malformed dates, equal dates, and caller-controlled fields', async () => {
    for (const body of [
      { fromDate: '2026-02-30', toDate }, { fromDate, toDate: 'bad' },
      { fromDate, toDate: fromDate }, { ...validBody, actor_id: actorId },
      { ...validBody, source_artifact_id: row.artifact_id },
    ]) expect((await POST(request(body), params)).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([['PT404', 404], ['P0002', 404], ['42501', 403], ['22023', 400], ['PT409', 409], ['55P03', 409], ['PGRST202', 503]])(
    'maps %s to %i', async (code, status) => {
      rpc.mockResolvedValueOnce({ data: null, error: { code, message: '', details: null, hint: null } })
      expect((await POST(request(validBody), params)).status).toBe(status)
    },
  )

  it('fails closed on missing, malformed, or misbound RPC responses', async () => {
    for (const envelope of [
      { data: { lesson_plan: null }, error: null },
      { data: { lesson_plan: { ...row, date: fromDate } }, error: null },
      { data: { lesson_plan: { ...row, classroom_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' } }, error: null },
      { data: { lesson_plan: { ...row, content: { type: 'doc', content: 'bad' } } }, error: null },
      { data: { lesson_plan: row } },
      { data: null, error: null },
    ]) {
      rpc.mockResolvedValueOnce(envelope)
      expect((await POST(request(validBody), params)).status).toBe(503)
    }
  })
})

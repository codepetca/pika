import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT, POST } from '@/app/api/teacher/classrooms/[id]/lesson-plans/[date]/route'
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
const date = '2026-09-19'
const plan = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  classroom_id: classroomId, date,
  content: { type: 'doc', content: [] }, content_markdown: 'Plan',
  artifact_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  source_artifact_id: null, source_blueprint_version_id: null,
  blueprint_archived_at: null,
  created_at: '2026-09-19T12:00:00+00:00', updated_at: '2026-09-19T12:00:00+00:00',
}
const makeRequest = (body: unknown, method = 'PUT') => new NextRequest(`http://localhost/api/teacher/classrooms/${classroomId}/lesson-plans/${date}`, {
  method, body: JSON.stringify(body),
})
const params = { params: Promise.resolve({ id: classroomId, date }) }
const rpc = vi.fn()

describe('shared-admission lesson-plan date writes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'student' } as AuthenticatedUser)
    vi.mocked(resolveClassroomAccess).mockResolvedValue({
      userId: actorId, classroomId, ownerId: actorId, relationship: 'owner', archived: false,
    })
    vi.mocked(getServiceRoleClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof getServiceRoleClient>)
    rpc.mockResolvedValue({ data: { applied: true, lesson_plan: plan }, error: null })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('lets an admitted student-valued owner use the actor-bound ordered RPC', async () => {
    const response = await PUT(makeRequest({ content_markdown: 'Plan', mutation: {
      client_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', sequence: 2,
    } }), params)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ applied: true, lesson_plan: { id: plan.id } })
    expect(rpc).toHaveBeenCalledWith('save_lesson_plan_for_owner_v1', expect.objectContaining({
      p_actor_id: actorId, p_classroom_id: classroomId, p_date: date, p_sequence: 2,
    }))
    expect(requireRole).not.toHaveBeenCalled()
  })

  it('aliases POST and preserves the unversioned clear response', async () => {
    rpc.mockResolvedValueOnce({ data: { applied: true, lesson_plan: null }, error: null })
    const response = await POST(makeRequest({ content_markdown: '  ' }, 'POST'), params)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ lesson_plan: null, date })
    expect(rpc).toHaveBeenCalledWith('save_lesson_plan_for_owner_v1', expect.objectContaining({ p_delete: true }))
  })

  it('returns stale ordered results unchanged and normalizes markdown before saving', async () => {
    rpc.mockResolvedValueOnce({ data: { applied: false, lesson_plan: null }, error: null })
    const response = await PUT(makeRequest({ content_markdown: 'Old\r\nPlan', mutation: {
      client_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', sequence: 1,
    } }), params)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ applied: false, lesson_plan: null })
    expect(rpc).toHaveBeenCalledWith('save_lesson_plan_for_owner_v1', expect.objectContaining({
      p_content_markdown: 'Old\nPlan', p_delete: false,
    }))
  })

  it('authenticates before resolving params or reading the body', async () => {
    vi.mocked(requireAuth).mockRejectedValueOnce(new AuthenticationError())
    const then = vi.fn()
    const request = makeRequest({ content_markdown: 'Plan' })
    request.json = vi.fn()
    const response = await PUT(request, { params: { then } as unknown as Promise<{ id: string; date: string }> })
    expect(response.status).toBe(401)
    expect(then).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('denies admitted nonowners and archived owners before the RPC', async () => {
    for (const relationship of ['member', 'owner'] as const) {
      vi.mocked(resolveClassroomAccess).mockResolvedValueOnce({
        userId: actorId, classroomId, ownerId: relationship === 'owner' ? actorId : plan.id,
        relationship, archived: relationship === 'owner',
      })
      const response = await PUT(makeRequest({ content_markdown: 'Plan' }), params)
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        error: relationship === 'owner' ? 'Classroom is archived' : 'Forbidden',
      })
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('keeps global role independent from current ownership', async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce({ id: actorId, role: 'teacher' } as AuthenticatedUser)
    expect((await PUT(makeRequest({ content_markdown: 'Plan' }), params)).status).toBe(200)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('rejects a missing classroom and invalid admission before body parsing', async () => {
    vi.mocked(resolveClassroomAccess).mockResolvedValueOnce(null)
    expect((await PUT(makeRequest({ content_markdown: 'Plan' }), params)).status).toBe(404)
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{invalid')
    const then = vi.fn()
    expect((await PUT(makeRequest({ content_markdown: 'Plan' }), {
      params: { then } as unknown as Promise<{ id: string; date: string }>,
    })).status).toBe(503)
    expect(then).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('preserves the nonadmitted role guard before params', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [] }))
    const forbidden = new Error('Forbidden')
    forbidden.name = 'AuthorizationError'
    vi.mocked(requireRole).mockRejectedValueOnce(forbidden)
    const then = vi.fn()
    const response = await PUT(makeRequest({ content_markdown: 'Plan' }), {
      params: { then } as unknown as Promise<{ id: string; date: string }>,
    })
    expect(response.status).toBe(403)
    expect(then).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects client supplied actor or lineage claims', async () => {
    for (const key of ['actor_id', 'source_blueprint_version_id', 'artifact_id']) {
      expect((await PUT(makeRequest({ content_markdown: 'Plan', [key]: actorId }), params)).status).toBe(400)
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects unknown or cross-class RPC rows and never falls back to table writes', async () => {
    for (const data of [{ applied: true, lesson_plan: { ...plan, classroom_id: actorId } },
      { applied: true, lesson_plan: { ...plan, unexpected: 1 } },
      { applied: false, lesson_plan: { ...plan, content: { type: 'bad' } } }]) {
      rpc.mockResolvedValueOnce({ data, error: null })
      expect((await PUT(makeRequest({ content_markdown: 'Plan' }), params)).status).toBe(503)
    }
    expect(vi.mocked(getServiceRoleClient).mock.results[0]?.value.from).toBeUndefined()
  })

  it.each([['42501', 403], ['P0002', 404], ['22023', 400], ['PT409', 409], ['PGRST202', 503]])(
    'maps RPC %s to %i', async (code, status) => {
      rpc.mockResolvedValueOnce({ data: null, error: { code } })
      expect((await PUT(makeRequest({ content_markdown: 'Plan' }), params)).status).toBe(status)
    },
  )

  it.each([['P0002', 404], ['42501', 403], ['PT409', 409]])(
    'maps a real SDK-shaped %s response with nullable error metadata to %i', async (code, status) => {
      rpc.mockResolvedValueOnce({
        data: null,
        error: { code, details: null, hint: null, message: 'Classroom not found' },
        count: null,
        status: 500,
        statusText: 'Internal Server Error',
      })
      expect((await PUT(makeRequest({ content_markdown: 'Plan' }), params)).status).toBe(status)
    },
  )

  it('fails closed when RPC construction throws or returns a malformed envelope', async () => {
    rpc.mockRejectedValueOnce(new Error('network'))
    expect((await PUT(makeRequest({ content_markdown: 'Plan' }), params)).status).toBe(503)
    rpc.mockResolvedValueOnce(undefined)
    expect((await PUT(makeRequest({ content_markdown: 'Plan' }), params)).status).toBe(503)
  })

  it('requires an explicit null SDK error on success', async () => {
    for (const envelope of [
      { data: { applied: true, lesson_plan: plan } },
      { data: { applied: true, lesson_plan: plan }, error: undefined },
      { data: { applied: true, lesson_plan: plan }, error: false },
      { data: { applied: true, lesson_plan: plan }, error: 0 },
    ]) {
      rpc.mockResolvedValueOnce(envelope)
      expect((await PUT(makeRequest({ content_markdown: 'Plan' }), params)).status).toBe(503)
    }
  })

  it('requires a valid SDK error envelope and never trusts result data beside an error', async () => {
    for (const envelope of [
      { data: { applied: true, lesson_plan: plan }, error: { code: 'PT409' } },
      { data: null, error: {} },
      { data: null, error: { code: 42501 } },
    ]) {
      rpc.mockResolvedValueOnce(envelope)
      expect((await PUT(makeRequest({ content_markdown: 'Plan' }), params)).status).toBe(503)
    }
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT } from '@/app/api/teacher/classrooms/[id]/lesson-plans/bulk/route'
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
const clientId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const first = '2026-09-19'
const second = '2026-09-20'
const third = '2026-09-21'
const row = (date: string) => ({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', classroom_id: classroomId, date,
  content: { type: 'doc', content: [] }, content_markdown: 'Plan',
  artifact_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  source_artifact_id: null, source_blueprint_version_id: null,
  blueprint_archived_at: null,
  created_at: '2026-09-19T12:00:00+00:00', updated_at: '2026-09-19T12:00:00+00:00',
})
const request = (body: unknown) => new NextRequest(`http://localhost/api/teacher/classrooms/${classroomId}/lesson-plans/bulk`, {
  method: 'PUT', body: JSON.stringify(body),
})
const params = { params: Promise.resolve({ id: classroomId }) }
const rpc = vi.fn()

describe('shared-admission lesson-plan bulk writes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, role: 'student' } as AuthenticatedUser)
    vi.mocked(resolveClassroomAccess).mockResolvedValue({
      userId: actorId, classroomId, ownerId: actorId, relationship: 'owner', archived: false,
    })
    vi.mocked(getServiceRoleClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof getServiceRoleClient>)
    rpc.mockResolvedValue({ data: { results: [
      { date: first, operation: 'upsert', applied: true, lesson_plan: row(first) },
      { date: second, operation: 'clear', applied: true, lesson_plan: null },
    ] }, error: null })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('sends one normalized atomic RPC for an admitted student-valued owner', async () => {
    const response = await PUT(request({
      plans: [{ date: first, content_markdown: 'One\r\nTwo' }], cleared_dates: [second],
      mutation: { client_id: clientId, sequence: 7 },
    }), params)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ updated: 1, cleared: 1, lesson_plans: [{ date: first }] })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('save_lesson_plans_for_owner_v1', expect.objectContaining({
      p_actor_id: actorId, p_classroom_id: classroomId,
      p_plans: [expect.objectContaining({ date: first, content_markdown: 'One\nTwo' })],
      p_cleared_dates: [second], p_client_id: clientId, p_sequence: 7,
    }))
    expect(requireRole).not.toHaveBeenCalled()
  })

  it('uses current ownership for a teacher-valued owner even when also enrolled', async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce({ id: actorId, role: 'teacher' } as AuthenticatedUser)
    vi.mocked(resolveClassroomAccess).mockResolvedValueOnce({
      userId: actorId, classroomId, ownerId: actorId, relationship: 'owner', archived: false,
      isEnrolled: true,
    } as Awaited<ReturnType<typeof resolveClassroomAccess>>)
    expect((await PUT(request({ plans: [{ date: first, content_markdown: 'Plan' }],
      cleared_dates: [second] }), params)).status).toBe(200)
    expect(requireRole).not.toHaveBeenCalled()
  })

  it('keeps blank upserts as saves and never sends client IDs for unversioned writes', async () => {
    const response = await PUT(request({ plans: [{ date: first, content_markdown: '' }], cleared_dates: [second] }), params)
    expect(response.status).toBe(200)
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_plans: [expect.objectContaining({ content_markdown: '' })] })
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_client_id')
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_sequence')
  })

  it('returns only current rows for upserts and counts accepted operations', async () => {
    rpc.mockResolvedValueOnce({ data: { results: [
      { date: first, operation: 'upsert', applied: false, lesson_plan: row(first) },
      { date: second, operation: 'upsert', applied: true, lesson_plan: row(second) },
      { date: third, operation: 'clear', applied: false, lesson_plan: row(third) },
    ] }, error: null })
    const response = await PUT(request({
      plans: [{ date: first, content_markdown: 'Old' }, { date: second, content_markdown: 'New' }],
      cleared_dates: [third], mutation: { client_id: clientId, sequence: 7 },
    }), params)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      updated: 1, cleared: 0,
      lesson_plans: [{ date: first }, { date: second }],
    })
  })

  it('accepts a stale upsert whose current row was already cleared', async () => {
    rpc.mockResolvedValueOnce({ data: { results: [
      { date: first, operation: 'upsert', applied: false, lesson_plan: null },
    ] }, error: null })
    const response = await PUT(request({
      plans: [{ date: first, content_markdown: 'Older plan' }],
      mutation: { client_id: clientId, sequence: 1 },
    }), params)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ updated: 0, cleared: 0, lesson_plans: [] })
  })

  it('counts equal-sequence replay from current rows without rewriting', async () => {
    rpc.mockResolvedValueOnce({ data: { results: [
      { date: first, operation: 'upsert', applied: false, lesson_plan: row(first) },
      { date: second, operation: 'clear', applied: false, lesson_plan: null },
    ] }, error: null })
    const response = await PUT(request({
      plans: [{ date: first, content_markdown: 'Old' }], cleared_dates: [second],
      mutation: { client_id: clientId, sequence: 7 },
    }), params)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ updated: 0, cleared: 0, lesson_plans: [{ date: first }] })
  })

  it('authenticates and verifies ownership before consuming the body', async () => {
    vi.mocked(requireAuth).mockRejectedValueOnce(new AuthenticationError())
    const then = vi.fn()
    const unread = request({ plans: [{ date: first, content_markdown: 'Plan' }] })
    const readBody = vi.spyOn(unread, 'json')
    expect((await PUT(unread, { params: { then } as unknown as Promise<{ id: string }> })).status).toBe(401)
    expect(then).not.toHaveBeenCalled()
    expect(readBody).not.toHaveBeenCalled()
    vi.mocked(resolveClassroomAccess).mockResolvedValueOnce(null)
    expect((await PUT(unread, params)).status).toBe(404)
    expect(readBody).not.toHaveBeenCalled()
  })

  it('denies nonowners and archived owners before body parsing', async () => {
    const unread = request({ plans: [{ date: first, content_markdown: 'Plan' }] })
    const readBody = vi.spyOn(unread, 'json')
    for (const relationship of ['member', 'owner'] as const) {
      vi.mocked(resolveClassroomAccess).mockResolvedValueOnce({
        userId: actorId, classroomId, ownerId: relationship === 'owner' ? actorId : clientId,
        relationship, archived: relationship === 'owner',
      })
      expect((await PUT(unread, params)).status).toBe(403)
    }
    expect(readBody).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects malformed admission before params or body', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{invalid')
    const then = vi.fn()
    const unread = request({ plans: [{ date: first, content_markdown: 'Plan' }] })
    const readBody = vi.spyOn(unread, 'json')
    expect((await PUT(unread, { params: { then } as unknown as Promise<{ id: string }> })).status).toBe(503)
    expect(then).not.toHaveBeenCalled()
    expect(readBody).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('keeps the nonadmitted teacher role guard before params', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [] }))
    const forbidden = new Error('Forbidden')
    forbidden.name = 'AuthorizationError'
    vi.mocked(requireRole).mockRejectedValueOnce(forbidden)
    const then = vi.fn()
    expect((await PUT(request({ plans: [{ date: first, content_markdown: 'Plan' }] }), {
      params: { then } as unknown as Promise<{ id: string }>,
    })).status).toBe(403)
    expect(then).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects malformed batches and supplied actor or lineage claims before the RPC', async () => {
    const malformed = [
      {},
      { plans: [{ date: first, content_markdown: 'x' }], cleared_dates: [first] },
      { plans: [{ date: first, content_markdown: 'x' }, { date: first, content_markdown: 'y' }] },
      { plans: [{ date: '2026-02-30', content_markdown: 'x' }] },
      { plans: [{ date: first, content_markdown: 'x', artifact_id: clientId }] },
      { plans: [{ date: first, content_markdown: 'x' }], actor_id: actorId },
      { cleared_dates: Array.from({ length: 251 }, () => first) },
    ]
    for (const body of malformed) expect((await PUT(request(body), params)).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('accepts the 250 plus 250 boundary as one request', async () => {
    const dates = Array.from({ length: 500 }, (_, index) => {
      const day = new Date(Date.UTC(2026, 0, index + 1))
      return day.toISOString().slice(0, 10)
    })
    rpc.mockResolvedValueOnce({ data: { results: [
      ...dates.slice(0, 250).map((date) => ({ date, operation: 'upsert', applied: true, lesson_plan: row(date) })),
      ...dates.slice(250).map((date) => ({ date, operation: 'clear', applied: true, lesson_plan: null })),
    ] }, error: null })
    const response = await PUT(request({
      plans: dates.slice(0, 250).map((date) => ({ date, content_markdown: 'Plan' })),
      cleared_dates: dates.slice(250),
    }), params)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ updated: 250, cleared: 250 })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('fails closed on malformed SDK envelopes, cardinality, binding, and missing RPC', async () => {
    const body = { plans: [{ date: first, content_markdown: 'Plan' }], cleared_dates: [second] }
    for (const envelope of [
      { data: { results: [] }, error: null },
      { data: { results: [{ date: second, operation: 'upsert', applied: true, lesson_plan: row(first) }] }, error: null },
      { data: { results: [{ date: first, operation: 'upsert', applied: true, lesson_plan: null },
        { date: second, operation: 'clear', applied: true, lesson_plan: null }] }, error: null },
      { data: { results: [{ date: first, operation: 'upsert', applied: true, lesson_plan: row(first) },
        { date: second, operation: 'clear', applied: true, lesson_plan: null }] } },
      { data: null, error: { code: 'PGRST202', details: null, hint: null, message: 'missing' } },
    ]) {
      rpc.mockResolvedValueOnce(envelope)
      expect((await PUT(request(body), params)).status).toBe(503)
    }
    expect(vi.mocked(getServiceRoleClient).mock.results[0]?.value.from).toBeUndefined()
  })

  it.each([['42501', 403], ['P0002', 404], ['22023', 400], ['PT409', 409]])(
    'maps real SDK-shaped %s errors to %i', async (code, status) => {
      rpc.mockResolvedValueOnce({ data: null, error: { code, message: '', details: null, hint: null },
        count: null, status: 500, statusText: 'Internal Server Error' })
      expect((await PUT(request({ cleared_dates: [first] }), params)).status).toBe(status)
    },
  )
})

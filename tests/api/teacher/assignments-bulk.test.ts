/** Route contracts; transaction rollback/reserved positions are verified by the existing database harness. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/assignments/bulk/route'
import { requireRole } from '@/lib/auth'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'

const { client } = vi.hoisted(() => ({ client: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => client }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherCanMutateClassroom: vi.fn() }))

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = '22222222-2222-4222-8222-222222222222'
const assignmentId = '33333333-3333-4333-8333-333333333333'
const createdId = '44444444-4444-4444-8444-444444444444'
const assignment = { title: 'Assignment', due_at: '2025-01-20T23:59:00Z', instructions: 'Explain your answer', is_draft: true, position: 0 }
const request = (body: unknown) => new NextRequest('http://localhost/api/teacher/assignments/bulk', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireRole).mockResolvedValue({ id: actorId, role: 'teacher', email: 'teacher@example.test' })
  vi.mocked(assertTeacherCanMutateClassroom).mockResolvedValue({ ok: true, classroom: { id: classroomId } } as never)
  client.from.mockImplementation(() => { throw new Error('Bulk writes must use the atomic owner service') })
  client.rpc.mockImplementation(async (_name, args) => {
    const rows = args.p_assignments as Array<{ id?: string }>
    const creates = rows.filter(row => !row.id)
    const updates = rows.filter(row => row.id)
    return { error: null, data: { ok: true, actor_id: actorId, classroom_id: classroomId,
      created: creates.length, updated: updates.length,
      assignments: [...creates.map(row => ({ ...row, id: createdId })), ...updates].map(row => ({ ...row, classroom_id: classroomId, created_by: actorId })),
    } }
  })
})

describe('legacy assignment bulk atomic boundary', () => {
  it.each([null, 1, [], 'input', {}, { classroom_id: classroomId }, { classroom_id: 'invalid', assignments: [] },
    { classroom_id: classroomId, assignments: [null] },
    { classroom_id: classroomId, assignments: [{ ...assignment, title: 42 }] },
    { classroom_id: classroomId, assignments: [{ ...assignment, title: ' ' }] },
    { classroom_id: classroomId, assignments: [{ ...assignment, due_at: 'not-a-date' }] },
    { classroom_id: classroomId, assignments: [{ ...assignment, instructions: 42 }] },
    { classroom_id: classroomId, assignments: [{ ...assignment, instructions: 'x'.repeat(100_001) }] },
    { classroom_id: classroomId, assignments: [{ ...assignment, title: 'x'.repeat(501) }] },
    { classroom_id: classroomId, assignments: [{ ...assignment, id: assignmentId, is_draft: undefined }] },
    { classroom_id: classroomId, assignments: Array.from({ length: 51 }, () => assignment) },
  ])('rejects malformed payload %j without data access', async body => {
    expect((await POST(request(body))).status).toBe(400)
    expect(client.from).not.toHaveBeenCalled()
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('authenticates before reading even malformed body data', async () => {
    const error = new Error('Unauthorized'); error.name = 'AuthenticationError'
    vi.mocked(requireRole).mockRejectedValueOnce(error)
    const input = request(null)
    const read = vi.spyOn(input, 'json')
    expect((await POST(input)).status).toBe(401)
    expect(read).not.toHaveBeenCalled()
  })

  it('saves mixed new and existing draft items with one legacy atomic command and parses the body once', async () => {
    const input = request({ classroom_id: classroomId, assignments: [assignment, { ...assignment, id: assignmentId, position: 3 }] })
    const read = vi.spyOn(input, 'json')
    const response = await POST(input)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ created: 1, updated: 1 })
    expect(read).toHaveBeenCalledTimes(1)
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith('save_legacy_assignments_bulk_for_owner_v1', {
      p_actor_id: actorId, p_classroom_id: classroomId,
      p_assignments: [expect.objectContaining({ title: 'Assignment', is_draft: true }), expect.objectContaining({ id: assignmentId, is_draft: true })],
    })
    expect(client.from).not.toHaveBeenCalled()
  })

  it.each([false, undefined])('forces new legacy entries to draft for requested state %s', async isDraft => {
    expect((await POST(request({ classroom_id: classroomId, assignments: [{ ...assignment, is_draft: isDraft }] }))).status).toBe(200)
    expect(client.rpc.mock.calls[0][1].p_assignments[0]).toMatchObject({ is_draft: true })
  })

  it('preserves the atomic service reserved-position result and input order', async () => {
    client.rpc.mockResolvedValueOnce({ error: null, data: { ok: true, actor_id: actorId, classroom_id: classroomId, created: 0, updated: 2,
      assignments: [{ id: createdId, position: 0 }, { id: assignmentId, position: 3 }].map(row => ({ ...row, classroom_id: classroomId, created_by: actorId })),
    } })
    const response = await POST(request({ classroom_id: classroomId, assignments: [{ ...assignment, id: createdId }, { ...assignment, id: assignmentId }] }))
    expect(response.status).toBe(200)
    expect((await response.json()).assignments.map((row: { position: number }) => row.position)).toEqual([0, 3])
    expect(client.from).not.toHaveBeenCalled()
  })

  it('delegates scheduled-to-draft transitions and live-release refusals to the transaction', async () => {
    client.rpc.mockResolvedValueOnce({ error: null, data: { ok: false, status: 400, errors: ['Cannot un-release assignment: Live'] } })
    const response = await POST(request({ classroom_id: classroomId, assignments: [{ ...assignment, id: assignmentId }] }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ errors: ['Cannot un-release assignment: Live'] })
    expect(client.rpc).toHaveBeenCalledOnce()
    expect(client.from).not.toHaveBeenCalled()
  })

  it.each([false, true])('uses one atomic create-and-release command (cutoff denial %s)', async denied => {
    if (denied) client.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT403', message: 'billing_classroom_new_work_unavailable' } })
    const response = await POST(request({ classroom_id: classroomId, assignments: [assignment, { ...assignment, id: assignmentId, is_draft: false }] }))
    expect(response.status).toBe(denied ? 403 : 200)
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith('save_legacy_assignments_bulk_for_owner_v1', expect.objectContaining({
      p_assignments: [expect.objectContaining({ is_draft: true }), expect.objectContaining({ id: assignmentId, is_draft: false })],
    }))
    expect(client.from).not.toHaveBeenCalled()
  })

  it('refuses ownership denial before the atomic write', async () => {
    vi.mocked(assertTeacherCanMutateClassroom).mockResolvedValueOnce({ ok: false, status: 403, error: 'Forbidden' })
    expect((await POST(request({ classroom_id: classroomId, assignments: [assignment] }))).status).toBe(403)
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['42501', 'Forbidden', 403], ['55000', 'assignment_bulk_archived', 403],
    ['40001', 'Concurrent change', 409], ['PGRST202', 'Missing atomic function', 503], ['XX000', 'Database error', 503],
  ])('fails closed on %s without manual writes or retries', async (code, message, status) => {
    client.rpc.mockResolvedValueOnce({ data: null, error: { code, message } })
    expect((await POST(request({ classroom_id: classroomId, assignments: [assignment, { ...assignment, id: assignmentId }] }))).status).toBe(status)
    expect(client.rpc).toHaveBeenCalledOnce()
    expect(client.from).not.toHaveBeenCalled()
  })
})

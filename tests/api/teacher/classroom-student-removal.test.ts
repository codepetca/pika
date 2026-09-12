import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/classrooms/[id]/roster/remove/route'

const mocks = vi.hoisted(() => ({ role: vi.fn(), owner: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRole: mocks.role }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherCanMutateClassroom: mocks.owner }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ rpc: mocks.rpc }) }))
const classroom = '10000000-0000-4000-8000-000000000001'
const roster = '20000000-0000-4000-8000-000000000001'
const teacher = '30000000-0000-4000-8000-000000000001'
const request = (body: unknown = { roster_ids: [roster] }) => new NextRequest('http://localhost/remove', {
  method: 'POST', body: JSON.stringify(body),
})
const context = { params: Promise.resolve({ id: classroom }) }

describe('remove students from class without erasure', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.role.mockResolvedValue({ id: teacher })
    mocks.owner.mockResolvedValue({ ok: true })
    mocks.rpc.mockResolvedValue({ data: { requested_count: 1, removed_count: 1 }, error: null })
  })

  it('uses only the preserving RPC and binds teacher, class and deduplicated selection', async () => {
    const response = await POST(request({ roster_ids: [roster, roster] }), context)
    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('remove_classroom_students_preserving_data', {
      p_teacher_id: teacher, p_classroom_id: classroom, p_roster_ids: [roster],
    })
    expect(await response.json()).toEqual({ success: true, requested_count: 1, removed_count: 1 })
  })

  it('denies an unauthorized class before calling the database mutation', async () => {
    mocks.owner.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    expect((await POST(request(), context)).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each([{ roster_ids: [] }, { roster_ids: ['invalid'] }, { roster_ids: [roster], purge: true }])(
    'rejects invalid scope %j', async (body) => {
      expect((await POST(request(body), context)).status).toBe(400)
      expect(mocks.rpc).not.toHaveBeenCalled()
    },
  )

  it('fails closed before migration without falling back to destructive removal', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
    const response = await POST(request(), context)
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('No student data was deleted') })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it.each(['40001', '40P01', '55P03'])('returns a retryable conflict for database contention %s', async (code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: 'private lock detail' } })
    const response = await POST(request(), context)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('This class is busy') })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('does not expose database error details', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'private student data' } })
    const response = await POST(request(), context)
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain('private student data')
  })

})

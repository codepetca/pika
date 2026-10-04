import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/student/tests/[id]/attempt/route'
import { assertStudentCanAccessTest } from '@/lib/server/tests'
const { maybeSingle, eq, select, from } = vi.hoisted(() => ({ maybeSingle: vi.fn(), eq: vi.fn(), select: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ from }) }))
vi.mock('@/lib/auth', () => ({ requireRole: async () => ({ id: 'student' }) }))
vi.mock('@/lib/server/tests', () => ({ assertStudentCanAccessTest: vi.fn() }))
const context = { params: Promise.resolve({ id: 'test' }) }
const request = () => new NextRequest('http://localhost/api/student/tests/test/attempt')
const attempt = { id: '10000000-0000-4000-8000-000000000001', test_id: '10000000-0000-4000-8000-000000000002', student_id: '10000000-0000-4000-8000-000000000003', responses: { q: 1 }, is_submitted: false, submitted_at: null, created_at: '2026-01-01', updated_at: '2026-01-01', draft_revision: 9 }
beforeEach(() => {
  vi.clearAllMocks()
  const chain = { eq, maybeSingle }
  eq.mockReturnValue(chain)
  select.mockReturnValue(chain)
  from.mockReturnValue({ select })
  maybeSingle.mockResolvedValue({ data: attempt, error: null })
  vi.mocked(assertStudentCanAccessTest).mockResolvedValue({ ok: true, test: { status: 'active' } } as never)
})
it('returns an authoritative revision and snapshot scoped to the authenticated student', async () => {
  const response = await GET(request(), context)
  expect(await response.json()).toEqual({ attempt })
  expect(eq).toHaveBeenCalledWith('student_id', 'student')
  expect(eq).toHaveBeenCalledWith('test_id', 'test')
})
it('returns null without inventing a revision for an unstarted test', async () => {
  maybeSingle.mockResolvedValueOnce({ data: null, error: null })
  expect(await (await GET(request(), context)).json()).toEqual({ attempt: null })
})
it('rejects archived/unenrolled access before reading answers', async () => {
  vi.mocked(assertStudentCanAccessTest).mockResolvedValueOnce({ ok: false, status: 403, error: 'Classroom is archived' })
  expect((await GET(request(), context)).status).toBe(403)
  expect(from).not.toHaveBeenCalled()
})
it('fails closed without a usable revision', async () => {
  maybeSingle.mockResolvedValueOnce({ data: { ...attempt, draft_revision: undefined }, error: null })
  expect((await GET(request(), context)).status).toBe(503)
})

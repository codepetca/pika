import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/student/tests/[id]/start/route'
import { requireRole } from '@/lib/auth'
import { ApiError } from '@/lib/api-handler'
import { mockAuthenticationError } from '../setup'
import { assertStudentCanAccessTest } from '@/lib/server/tests'
import { getTestEditingPolicy } from '@/lib/server/test-editing-policy'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ rpc }) }))
vi.mock('@/lib/server/tests', () => ({ assertStudentCanAccessTest: vi.fn() }))
vi.mock('@/lib/server/test-editing-policy', () => ({ getTestEditingPolicy: vi.fn() }))
const context = { params: Promise.resolve({ id: 'test-1' }) }
const request = () => new NextRequest('http://localhost/api/student/tests/test-1/start', { method: 'POST' })
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireRole).mockResolvedValue({ id: 'student-1' } as never)
  vi.mocked(assertStudentCanAccessTest).mockResolvedValue({ ok: true, test: {} } as never)
  vi.mocked(getTestEditingPolicy).mockResolvedValue({ structureLocked: false })
  rpc.mockResolvedValue({ data: { questions: [] }, error: null })
})
it('starts/resumes atomically without sending an empty overwrite of saved work', async () => {
  expect((await POST(request(), context)).status).toBe(200)
  expect(rpc).toHaveBeenCalledWith('save_test_attempt_atomic', { p_test_id: 'test-1', p_student_id: 'student-1', p_responses: null })
})
it('requires authentication', async () => {
  vi.mocked(requireRole).mockRejectedValueOnce(mockAuthenticationError())
  expect((await POST(request(), context)).status).toBe(401)
  expect(rpc).not.toHaveBeenCalled()
})
it('preserves enrollment and archive authorization', async () => {
  vi.mocked(assertStudentCanAccessTest).mockResolvedValueOnce({ ok: false, status: 403, error: 'Classroom is archived' })
  expect((await POST(request(), context)).status).toBe(403)
  expect(rpc).not.toHaveBeenCalled()
})
it('does not claim Start on an unmigrated schema', async () => {
  vi.mocked(getTestEditingPolicy).mockRejectedValueOnce(new ApiError(503, 'Migration required'))
  expect((await POST(request(), context)).status).toBe(503)
  expect(rpc).not.toHaveBeenCalled()
})
it('surfaces closure that races with Start', async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'This test is closed for you.' } })
  expect((await POST(request(), context)).status).toBe(403)
})

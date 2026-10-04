import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/tests/[id]/return/route'
import { requireRole } from '@/lib/auth'
import { returnStudentTestAttempts } from '@/lib/server/test-return'
import { mockAuthenticationError } from '../setup'
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/server/test-return', () => ({ returnStudentTestAttempts: vi.fn() }))
const student = '10000000-0000-4000-8000-000000000001'
const context = { params: Promise.resolve({ id: 'test' }) }
const request = (body: unknown) => new NextRequest('http://localhost/api/teacher/tests/test/return', { method: 'POST', body: JSON.stringify(body) })
describe('Test Return route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireRole).mockResolvedValue({ id: 'teacher' } as never)
    vi.mocked(returnStudentTestAttempts).mockResolvedValue({ ok: true, counts: { returned_count: 1, already_returned_count: 0, skipped_count: 0, test_closed: false } })
  })
  it('authenticates before parsing a malformed request', async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(mockAuthenticationError())
    const response = await POST(new NextRequest('http://localhost/api/teacher/tests/test/return', { method: 'POST', body: '{' }), context)
    expect(response.status).toBe(401)
    expect(returnStudentTestAttempts).not.toHaveBeenCalled()
  })
  it.each([{}, { student_ids: [] }, { student_ids: ['invalid'] }, { student_ids: [student, null] }, { student_ids: Array(101).fill(student) }])('rejects invalid selection %j', async (body) => {
    expect((await POST(request(body), context)).status).toBe(400)
    expect(returnStudentTestAttempts).not.toHaveBeenCalled()
  })
  it('deduplicates selection and reports the committed result', async () => {
    const response = await POST(request({ student_ids: [student, student] }), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ returned_count: 1, already_returned_count: 0, skipped_count: 0, test_closed: false })
    expect(returnStudentTestAttempts).toHaveBeenCalledWith({ testId: 'test', teacherId: 'teacher', studentIds: [student] })
  })
  it.each([403, 409, 503])('propagates authoritative ownership/lifecycle/schema failure %s', async (status) => {
    vi.mocked(returnStudentTestAttempts).mockResolvedValueOnce({ ok: false, status, error: 'guard failed' })
    const response = await POST(request({ student_ids: [student] }), context)
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: 'guard failed' })
  })
})

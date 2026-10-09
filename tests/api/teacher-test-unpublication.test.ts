import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/tests/[id]/unpublish/route'
import { requireRole } from '@/lib/auth'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { returnTestToDraft } from '@/lib/server/test-unpublication'

vi.mock('@/lib/auth', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/server/tests', () => ({ assertTeacherOwnsTest: vi.fn() }))
vi.mock('@/lib/server/test-unpublication', () => ({ returnTestToDraft: vi.fn() }))

const actorId = '11111111-1111-4111-8111-111111111111'
const testId = '22222222-2222-4222-8222-222222222222'
const test = { id: testId, classroom_id: '33333333-3333-4333-8333-333333333333', title: 'Current', status: 'draft', show_results: false, documents: [] }
const invoke = (body: unknown = {}, id = testId) => POST(new NextRequest('http://localhost', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id }) })

describe('POST return Test to draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireRole).mockResolvedValue({ id: actorId, role: 'teacher', email: 'owner@example.test' })
    vi.mocked(assertTeacherOwnsTest).mockResolvedValue({ ok: true, test } as never)
    vi.mocked(returnTestToDraft).mockResolvedValue({ test, draft_version: 8 })
  })

  it('authenticates before reading params or body', async () => {
    vi.mocked(requireRole).mockRejectedValue(Object.assign(new Error('Unauthorized'), { name: 'AuthenticationError' }))
    const response = await invoke()
    expect(response.status).toBe(401)
    expect(assertTeacherOwnsTest).not.toHaveBeenCalled()
    expect(returnTestToDraft).not.toHaveBeenCalled()
  })

  it('rejects malformed Test IDs and unknown body keys', async () => {
    expect((await invoke({}, 'bad')).status).toBe(400)
    expect((await invoke({ status: 'draft' })).status).toBe(400)
    expect((await invoke(null)).status).toBe(400)
    expect(returnTestToDraft).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON after authentication', async () => {
    const response = await POST(new NextRequest('http://localhost', { method: 'POST', body: '{' }), { params: Promise.resolve({ id: testId }) })
    expect(response.status).toBe(400)
    expect(requireRole).toHaveBeenCalledWith('teacher')
    expect(returnTestToDraft).not.toHaveBeenCalled()
  })

  it('uses existing ownership and archive semantics', async () => {
    vi.mocked(assertTeacherOwnsTest).mockResolvedValue({ ok: false, status: 403, error: 'Classroom is archived' })
    expect((await invoke()).status).toBe(403)
    expect(returnTestToDraft).not.toHaveBeenCalled()
  })

  it('returns the authoritative draft identity and version', async () => {
    const response = await invoke()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ test, draft_version: 8 })
    expect(assertTeacherOwnsTest).toHaveBeenCalledWith(actorId, testId, { checkArchived: true })
    expect(returnTestToDraft).toHaveBeenCalledWith(actorId, testId, test.classroom_id)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DELETE, PATCH } from '@/app/api/teacher/tests/[id]/questions/[qid]/route'

const from = vi.fn()

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => ({ from })),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({ id: 'teacher-1', role: 'teacher' })),
}))

vi.mock('@/lib/server/tests', () => ({
  assertTeacherOwnsTest: vi.fn(async () => ({
    ok: true,
    test: { id: 'test-1', classroom_id: 'classroom-1', status: 'active' },
  })),
}))

describe('/api/teacher/tests/[id]/questions/[qid]', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['PATCH', PATCH],
    ['DELETE', DELETE],
  ] as const)('retires direct %s row mutation in favor of the versioned draft', async (method, handler) => {
    const response = await handler(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/questions/portable-id', {
        method,
        ...(method === 'PATCH' ? { body: JSON.stringify({ question_text: 'Changed' }) } : {}),
      }),
      { params: Promise.resolve({ id: 'test-1', qid: 'portable-id' }) },
    )

    expect(response.status).toBe(410)
    expect(await response.json()).toEqual({
      error: 'Direct question writes are retired; save the versioned Test draft instead',
      draft_endpoint: '/api/teacher/tests/test-1/draft',
    })
    expect(from).not.toHaveBeenCalled()
  })
})

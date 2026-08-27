import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/tests/[id]/questions/route'

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
    test: { id: 'test-1', classroom_id: 'classroom-1', status: 'draft' },
  })),
}))

describe('POST /api/teacher/tests/[id]/questions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retires direct row creation in favor of the versioned draft endpoint', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/questions', {
        method: 'POST',
        body: JSON.stringify({ question_text: 'Bypass the draft' }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) },
    )

    expect(response.status).toBe(410)
    expect(await response.json()).toEqual({
      error: 'Direct question writes are retired; save the versioned Test draft instead',
      draft_endpoint: '/api/teacher/tests/test-1/draft',
    })
    expect(from).not.toHaveBeenCalled()
  })
})

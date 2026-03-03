import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/tests/[id]/questions/reorder/route'

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({
    id: 'teacher-1',
    email: 'teacher@example.com',
    role: 'teacher',
  })),
}))

vi.mock('@/lib/server/tests', () => ({
  assertTeacherOwnsTest: vi.fn(async () => ({
    ok: true,
    test: {
      id: 'test-1',
      status: 'draft',
    },
  })),
}))

const mockSupabaseClient = { from: vi.fn() }

function buildRequest(questionIds: string[]) {
  return new NextRequest('http://localhost:3000/api/teacher/tests/test-1/questions/reorder', {
    method: 'POST',
    body: JSON.stringify({ question_ids: questionIds }),
  })
}

describe('POST /api/teacher/tests/[id]/questions/reorder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates question positions without using upsert inserts', async () => {
    const updateCalls: Array<{ testId: string; id: string; position: number }> = []

    ;(mockSupabaseClient.from as any) = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ data: [{ id: 'q-1' }, { id: 'q-2' }], error: null }),
      })),
      update: vi.fn((payload: { position: number }) => ({
        eq: vi.fn((column: string, testId: string) => {
          expect(column).toBe('test_id')
          return {
            eq: vi.fn((idColumn: string, id: string) => {
              expect(idColumn).toBe('id')
              updateCalls.push({ testId, id, position: payload.position })
              return Promise.resolve({ error: null })
            }),
          }
        }),
      })),
    }))

    const response = await POST(buildRequest(['q-2', 'q-1']), {
      params: Promise.resolve({ id: 'test-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(updateCalls).toEqual([
      { testId: 'test-1', id: 'q-2', position: 0 },
      { testId: 'test-1', id: 'q-1', position: 1 },
    ])
  })

  it('returns 400 when question_ids does not include all test questions', async () => {
    const updateSpy = vi.fn()

    ;(mockSupabaseClient.from as any) = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ data: [{ id: 'q-1' }, { id: 'q-2' }], error: null }),
      })),
      update: updateSpy,
    }))

    const response = await POST(buildRequest(['q-1']), {
      params: Promise.resolve({ id: 'test-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('question_ids must include all questions in the test')
    expect(updateSpy).not.toHaveBeenCalled()
  })
})

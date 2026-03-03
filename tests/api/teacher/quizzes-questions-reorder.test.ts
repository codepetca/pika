import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/quizzes/[id]/questions/reorder/route'

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

vi.mock('@/lib/server/quizzes', () => ({
  assertTeacherOwnsQuiz: vi.fn(async () => ({
    ok: true,
    quiz: {
      id: 'quiz-1',
      status: 'draft',
    },
  })),
}))

const mockSupabaseClient = { from: vi.fn() }

function buildRequest(questionIds: string[]) {
  return new NextRequest('http://localhost:3000/api/teacher/quizzes/quiz-1/questions/reorder', {
    method: 'POST',
    body: JSON.stringify({ question_ids: questionIds }),
  })
}

describe('POST /api/teacher/quizzes/[id]/questions/reorder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates question positions without using upsert inserts', async () => {
    const updateCalls: Array<{ quizId: string; id: string; position: number }> = []

    ;(mockSupabaseClient.from as any) = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ data: [{ id: 'q-1' }, { id: 'q-2' }], error: null }),
      })),
      update: vi.fn((payload: { position: number }) => ({
        eq: vi.fn((column: string, quizId: string) => {
          expect(column).toBe('quiz_id')
          return {
            eq: vi.fn((idColumn: string, id: string) => {
              expect(idColumn).toBe('id')
              updateCalls.push({ quizId, id, position: payload.position })
              return Promise.resolve({ error: null })
            }),
          }
        }),
      })),
    }))

    const response = await POST(buildRequest(['q-2', 'q-1']), {
      params: Promise.resolve({ id: 'quiz-1' }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(updateCalls).toEqual([
      { quizId: 'quiz-1', id: 'q-2', position: 0 },
      { quizId: 'quiz-1', id: 'q-1', position: 1 },
    ])
  })
})

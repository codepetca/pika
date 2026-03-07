import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/student/quizzes/[id]/route'

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({
    id: 'student-1',
    email: 'student1@example.com',
    role: 'student',
  })),
}))

vi.mock('@/lib/server/quizzes', () => ({
  assertStudentCanAccessQuiz: vi.fn(async () => ({
    ok: true,
    quiz: {
      id: 'quiz-1',
      classroom_id: 'classroom-1',
      title: 'Quiz 1',
      status: 'active',
      opens_at: null,
      show_results: false,
      position: 0,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  })),
  isQuizVisibleToStudents: vi.fn(() => true),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/student/quizzes/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not request or return correct_option in student question payloads', async () => {
    let questionSelectColumns = ''

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'quiz_responses') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }

      if (table === 'quiz_questions') {
        return {
          select: vi.fn((columns: string) => {
            questionSelectColumns = columns
            return {
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'question-1',
                    quiz_id: 'quiz-1',
                    question_text: 'What is 2 + 2?',
                    options: ['4', '5'],
                    position: 0,
                    created_at: '2026-01-01T00:00:00.000Z',
                    updated_at: '2026-01-01T00:00:00.000Z',
                  },
                ],
                error: null,
              }),
            }
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/quizzes/quiz-1'),
      { params: Promise.resolve({ id: 'quiz-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(questionSelectColumns).not.toContain('correct_option')
    expect(data.questions[0].correct_option).toBeUndefined()
  })
})

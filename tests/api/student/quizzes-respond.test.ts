import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/student/quizzes/[id]/respond/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async (role: string) => {
    if (role === 'student') {
      return { id: 'student-1', email: 'student@example.com', role: 'student' }
    }
    throw new Error('Unauthorized')
  }),
}))

vi.mock('@/lib/server/quizzes', () => ({
  assertStudentCanAccessQuiz: vi.fn(),
  isQuizVisibleToStudents: (quiz: { status: string; opens_at: string | null }, now: Date = new Date()) => {
    if (quiz.status !== 'active') return false
    if (!quiz.opens_at) return true
    return new Date(quiz.opens_at).getTime() <= now.getTime()
  },
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

const mockSupabaseClient = {
  from: vi.fn(),
}

describe('POST /api/student/quizzes/[id]/respond', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('blocks responses before scheduled opens_at', async () => {
    const { assertStudentCanAccessQuiz } = await import('@/lib/server/quizzes')
    ;(assertStudentCanAccessQuiz as any).mockResolvedValueOnce({
      ok: true,
      quiz: {
        id: 'quiz-1',
        classroom_id: 'classroom-1',
        status: 'active',
        opens_at: '2099-03-01T14:00:00.000Z',
      },
    })

    const request = new NextRequest('http://localhost:3000/api/student/quizzes/quiz-1/respond', {
      method: 'POST',
      body: JSON.stringify({ responses: { q1: 0 } }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'quiz-1' }) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Quiz is not active')
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })

  it('allows responses when quiz is active and open', async () => {
    const { assertStudentCanAccessQuiz } = await import('@/lib/server/quizzes')
    ;(assertStudentCanAccessQuiz as any).mockResolvedValueOnce({
      ok: true,
      quiz: {
        id: 'quiz-1',
        classroom_id: 'classroom-1',
        status: 'active',
        opens_at: '2020-03-01T14:00:00.000Z',
      },
    })

    ;(mockSupabaseClient.from as any).mockImplementation((table: string) => {
      if (table === 'quiz_responses') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue({ data: [] }),
              })),
            })),
          })),
          insert: vi.fn().mockResolvedValue({ error: null }),
        }
      }
      if (table === 'quiz_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [
                { id: 'q1', options: ['A', 'B'] },
                { id: 'q2', options: ['A', 'B'] },
              ],
              error: null,
            }),
          })),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/student/quizzes/quiz-1/respond', {
      method: 'POST',
      body: JSON.stringify({ responses: { q1: 0, q2: 1 } }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'quiz-1' }) })
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.success).toBe(true)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/student/quizzes/[id]/results/route'
import { mockAuthenticationError } from '../setup'

const mockSupabaseClient = { from: vi.fn() }

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

vi.mock('@/lib/server/quizzes', async () => {
  const actual = await vi.importActual<any>('@/lib/server/quizzes')
  return {
    ...actual,
    assertStudentCanAccessQuiz: vi.fn(async () => ({
      ok: true,
      quiz: {
        id: 'quiz-1',
        classroom_id: 'classroom-1',
        title: 'Quiz One',
        status: 'closed',
        show_results: true,
        opens_at: null,
        position: 0,
        created_by: 'teacher-1',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        classrooms: {
          id: 'classroom-1',
          teacher_id: 'teacher-1',
          archived_at: null,
        },
      },
    })),
  }
})

describe('GET /api/student/quizzes/[id]/results', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    ;(requireRole as any).mockRejectedValueOnce(mockAuthenticationError())

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/quizzes/quiz-1/results'),
      { params: Promise.resolve({ id: 'quiz-1' }) }
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 when results are not yet visible to the student', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'quiz_responses') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/quizzes/quiz-1/results'),
      { params: Promise.resolve({ id: 'quiz-1' }) }
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Results are not available for this quiz',
    })
  })

  it('returns 500 when question loading fails', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'quiz_responses') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [{ id: 'response-1' }], error: null }),
          })),
        }
      }

      if (table === 'quiz_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/quizzes/quiz-1/results'),
      { params: Promise.resolve({ id: 'quiz-1' }) }
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to fetch questions' })
  })

  it('returns aggregated results and the student response map', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'quiz_responses') {
        return {
          select: vi.fn((columns: string) => {
            if (columns === 'id') {
              return {
                eq: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue({ data: [{ id: 'response-1' }], error: null }),
              }
            }

            if (columns === '*') {
              return {
                eq: vi.fn().mockResolvedValue({
                  data: [
                    { question_id: 'question-1', selected_option: 0, student_id: 'student-1' },
                    { question_id: 'question-1', selected_option: 1, student_id: 'student-2' },
                  ],
                  error: null,
                }),
              }
            }

            const chain: any = {
              eq: vi.fn(() => chain),
              then: vi.fn((resolve: (value: unknown) => unknown) =>
                resolve({
                  data: [{ question_id: 'question-1', selected_option: 0 }],
                  error: null,
                })
              ),
            }

            return chain
          }),
        }
      }

      if (table === 'quiz_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'question-1',
                  question_text: '2 + 2 = ?',
                  options: ['4', '5'],
                  correct_option: 0,
                  position: 0,
                },
              ],
              error: null,
            }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/quizzes/quiz-1/results'),
      { params: Promise.resolve({ id: 'quiz-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.quiz).toEqual({
      id: 'quiz-1',
      title: 'Quiz One',
      status: 'closed',
    })
    expect(data.results).toEqual([
      {
        question_id: 'question-1',
        question_text: '2 + 2 = ?',
        options: ['4', '5'],
        counts: [1, 1],
        total_responses: 2,
      },
    ])
    expect(data.my_responses).toEqual({ 'question-1': 0 })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/student/tests/[id]/results/route'

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

vi.mock('@/lib/server/tests', async () => {
  const actual = await vi.importActual<any>('@/lib/server/tests')
  return {
    ...actual,
    assertStudentCanAccessTest: vi.fn(async () => ({
      ok: true,
      test: {
        id: 'test-1',
        classroom_id: 'classroom-1',
        title: 'Unit Test',
        status: 'closed',
        show_results: true,
        position: 0,
        points_possible: 1,
        include_in_final: true,
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

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/student/tests/[id]/results', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('blocks results when return columns are missing (cannot verify returned state)', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_attempts') {
        return {
          select: vi.fn((columns: string) => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue(
              columns.includes('returned_at')
                ? {
                    data: null,
                    error: {
                      code: 'PGRST204',
                      message: "Could not find column 'returned_at'",
                    },
                  }
                : {
                    data: { is_submitted: true },
                    error: null,
                  }
            ),
          })),
        }
      }

      if (table === 'test_responses') {
        return {
          select: vi.fn((columns: string) => ({
            eq: vi.fn().mockReturnThis(),
            then: vi.fn((resolve: any) => {
              if (columns.includes('submitted_at')) {
                resolve({
                  data: [
                    {
                      id: 'response-1',
                      test_id: 'test-1',
                      question_id: 'question-1',
                      student_id: 'student-1',
                      selected_option: 0,
                      response_text: null,
                      score: 1,
                      feedback: null,
                      graded_at: null,
                      submitted_at: '2026-01-01T00:00:00.000Z',
                    },
                  ],
                  error: null,
                })
                return
              }

              if (columns.includes('question_id')) {
                resolve({
                  data: [
                    {
                      id: 'response-1',
                      question_id: 'question-1',
                      selected_option: 0,
                      response_text: null,
                      score: 1,
                      feedback: null,
                      graded_at: null,
                    },
                  ],
                  error: null,
                })
                return
              }

              resolve({
                data: [
                  {
                    selected_option: 0,
                    response_text: null,
                  },
                ],
                error: null,
              })
            }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/tests/test-1/results'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Results are available after your teacher returns this test')
  })

  it('returns results when test work has been returned', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { is_submitted: true, returned_at: '2026-03-05T11:00:00.000Z' },
              error: null,
            }),
          })),
        }
      }

      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'question-1',
                  question_type: 'open_response',
                  question_text: 'Write a loop.',
                  options: [],
                  correct_option: null,
                  points: 5,
                  response_max_chars: 5000,
                  response_monospace: true,
                  sample_solution: 'for (int i = 0; i < 5; i++) {\n  println(i);\n}',
                  position: 0,
                },
              ],
              error: null,
            }),
          })),
        }
      }

      if (table === 'test_responses') {
        return {
          select: vi.fn((columns: string) => ({
            eq: vi.fn().mockReturnThis(),
            then: vi.fn((resolve: any) => {
              if (columns.includes('submitted_at')) {
                resolve({
                  data: [
                    {
                      id: 'response-1',
                      test_id: 'test-1',
                      question_id: 'question-1',
                      student_id: 'student-1',
                      selected_option: null,
                      response_text: 'for (int i = 0; i < 5; i++) println(i);',
                      score: 4,
                      feedback: 'Good start',
                      graded_at: '2026-03-06T12:00:00.000Z',
                      submitted_at: '2026-01-01T00:00:00.000Z',
                    },
                  ],
                  error: null,
                })
                return
              }

              if (columns.includes('question_id')) {
                resolve({
                  data: [
                    {
                      id: 'response-1',
                      question_id: 'question-1',
                      selected_option: null,
                      response_text: 'for (int i = 0; i < 5; i++) println(i);',
                      score: 4,
                      feedback: 'Good start',
                      graded_at: '2026-03-06T12:00:00.000Z',
                    },
                  ],
                  error: null,
                })
                return
              }

              resolve({
                data: [
                  {
                    selected_option: null,
                    response_text: 'for (int i = 0; i < 5; i++) println(i);',
                  },
                ],
                error: null,
              })
            }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/tests/test-1/results'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.quiz.id).toBe('test-1')
    expect(data.quiz.returned_at).toBe('2026-03-05T11:00:00.000Z')
    expect(data.summary.earned_points).toBe(4)
    expect(data.question_results[0].sample_solution).toContain('println')
  })
})

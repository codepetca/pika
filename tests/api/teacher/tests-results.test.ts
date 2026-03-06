import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/teacher/tests/[id]/results/route'

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

vi.mock('@/lib/server/tests', async () => {
  const actual = await vi.importActual<any>('@/lib/server/tests')
  return {
    ...actual,
    assertTeacherOwnsTest: vi.fn(async () => ({
      ok: true,
      test: {
        id: 'test-1',
        classroom_id: 'classroom-1',
        title: 'Unit Test',
        status: 'active',
        show_results: false,
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

describe('GET /api/teacher/tests/[id]/results', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('falls back when test_attempts return columns are missing', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'question-1',
                  test_id: 'test-1',
                  question_type: 'multiple_choice',
                  question_text: '2 + 2 = ?',
                  options: ['4', '5'],
                  correct_option: 0,
                  points: 1,
                  response_max_chars: 5000,
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
            eq: vi.fn().mockResolvedValue(
              columns.includes('ai_grading_basis')
                ? {
                    data: null,
                    error: {
                      code: 'PGRST204',
                      message: "Could not find column 'ai_grading_basis'",
                    },
                  }
                : {
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
                        graded_by: null,
                        submitted_at: '2026-01-01T00:00:00.000Z',
                      },
                    ],
                    error: null,
                  }
            ),
          })),
        }
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [{ student_id: 'student-1' }],
              error: null,
            }),
          })),
        }
      }

      if (table === 'test_attempts') {
        return {
          select: vi.fn((columns: string) => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue(
              columns.includes('returned_at')
                ? {
                    data: null,
                    error: {
                      code: 'PGRST204',
                      message: "Could not find column 'returned_at'",
                    },
                  }
                : {
                    data: [
                      {
                        student_id: 'student-1',
                        is_submitted: true,
                        submitted_at: '2026-01-01T00:00:00.000Z',
                        updated_at: '2026-01-01T00:00:00.000Z',
                      },
                    ],
                    error: null,
                  }
            ),
          })),
        }
      }

      if (table === 'users') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [{ id: 'student-1', email: 'student1@example.com' }],
              error: null,
            }),
          })),
        }
      }

      if (table === 'student_profiles') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [{ user_id: 'student-1', first_name: 'Student', last_name: 'One' }],
              error: null,
            }),
          })),
        }
      }

      if (table === 'test_focus_events') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/results'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.students).toHaveLength(1)
    expect(data.students[0].returned_at).toBeNull()
    expect(data.students[0].returned_by).toBeNull()
    expect(data.students[0].status).toBe('submitted')
  })

  it('does not mark students submitted when only placeholder open-response rows exist', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'question-open-1',
                  test_id: 'test-1',
                  question_type: 'open_response',
                  question_text: 'Explain your reasoning.',
                  options: [],
                  correct_option: null,
                  points: 2,
                  response_max_chars: 5000,
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
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'response-1',
                  test_id: 'test-1',
                  question_id: 'question-open-1',
                  student_id: 'student-1',
                  selected_option: null,
                  response_text: '   ',
                  score: 0,
                  feedback: 'No response submitted.',
                  graded_at: '2026-03-06T10:00:00.000Z',
                  graded_by: 'teacher-1',
                  ai_grading_basis: null,
                  ai_reference_answers: null,
                  ai_model: null,
                  submitted_at: '2026-03-06T10:00:00.000Z',
                },
              ],
              error: null,
            }),
          })),
        }
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [{ student_id: 'student-1' }],
              error: null,
            }),
          })),
        }
      }

      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }

      if (table === 'users') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [{ id: 'student-1', email: 'student1@example.com' }],
              error: null,
            }),
          })),
        }
      }

      if (table === 'student_profiles') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [{ user_id: 'student-1', first_name: 'Student', last_name: 'One' }],
              error: null,
            }),
          })),
        }
      }

      if (table === 'test_focus_events') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/results'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.students).toHaveLength(1)
    expect(data.students[0].status).toBe('not_started')
    expect(data.stats.responded).toBe(0)
  })
})

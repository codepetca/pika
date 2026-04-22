import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/teacher/tests/[id]/results/route'

const { getActiveTestAiGradingRunSummary } = vi.hoisted(() => ({
  getActiveTestAiGradingRunSummary: vi.fn(),
}))

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

vi.mock('@/lib/server/test-ai-grading-runs', () => ({
  getActiveTestAiGradingRunSummary,
}))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/teacher/tests/[id]/results', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getActiveTestAiGradingRunSummary.mockResolvedValue(null)
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
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
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
    expect(data.active_ai_grading_run).toBeNull()
  })

  it('includes in-progress draft answers from test_attempts for teacher monitoring', async () => {
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
                  question_text: 'Explain your process',
                  options: [],
                  correct_option: null,
                  points: 5,
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
              data: [],
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
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  student_id: 'student-1',
                  is_submitted: false,
                  submitted_at: null,
                  returned_at: null,
                  returned_by: null,
                  updated_at: '2026-01-02T12:00:00.000Z',
                  responses: {
                    'question-open-1': {
                      question_type: 'open_response',
                      response_text: 'Draft answer in progress',
                    },
                  },
                },
              ],
              error: null,
            }),
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
    expect(data.students[0].status).toBe('in_progress')
    expect(data.students[0].answers['question-open-1']).toEqual({
      response_id: null,
      question_type: 'open_response',
      selected_option: null,
      response_text: 'Draft answer in progress',
      score: null,
      feedback: null,
      graded_at: null,
      is_draft: true,
    })
    expect(data.responders).toEqual([])
  })

  it('includes the active AI grading run summary when one is present', async () => {
    getActiveTestAiGradingRunSummary.mockResolvedValueOnce({
      id: 'run-1',
      test_id: 'test-1',
      status: 'running',
      model: 'gpt-5-nano',
      prompt_guideline_override: null,
      requested_count: 2,
      eligible_student_count: 2,
      queued_response_count: 2,
      processed_count: 1,
      completed_count: 1,
      skipped_unanswered_count: 0,
      skipped_already_graded_count: 0,
      failed_count: 0,
      pending_count: 1,
      next_retry_at: null,
      error_samples: [],
      started_at: '2026-04-20T12:00:00.000Z',
      completed_at: null,
      created_at: '2026-04-20T12:00:00.000Z',
    })

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
                  question_text: 'Explain your process',
                  options: [],
                  correct_option: null,
                  points: 5,
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
              data: [],
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
            in: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
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
    expect(data.active_ai_grading_run).toEqual(
      expect.objectContaining({
        id: 'run-1',
        status: 'running',
        pending_count: 1,
      }),
    )
  })
})

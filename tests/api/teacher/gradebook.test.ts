import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PATCH } from '@/app/api/teacher/gradebook/route'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))

const mockSupabaseClient = { from: vi.fn() }

type GradebookFixture = {
  enrollments?: Array<{ student_id: string; users: { email: string } }>
  profiles?: Array<{ user_id: string; first_name: string | null; last_name: string | null }>
  assignments?: Array<any>
  docs?: Array<any>
  quizzes?: Array<any>
  quizQuestions?: Array<any>
  quizResponses?: Array<any>
  quizOverrides?: Array<any>
  settings?: { use_weights: boolean; assignments_weight: number; quizzes_weight: number } | null
}

function buildMockFrom(fixture: GradebookFixture) {
  return vi.fn((table: string) => {
    if (table === 'classrooms') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { id: 'c1', teacher_id: 'teacher-1', archived_at: null },
              error: null,
            }),
          })),
        })),
      }
    }

    if (table === 'gradebook_settings') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: fixture.settings ?? null,
              error: null,
            }),
          })),
        })),
      }
    }

    if (table === 'classroom_enrollments') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({
            data:
              fixture.enrollments ?? [
                {
                  student_id: 'student-1',
                  users: { email: 'student1@example.com' },
                },
              ],
            error: null,
          }),
        })),
      }
    }

    if (table === 'student_profiles') {
      return {
        select: vi.fn(() => ({
          in: vi.fn().mockResolvedValue({
            data:
              fixture.profiles ?? [
                { user_id: 'student-1', first_name: 'Student', last_name: 'One' },
              ],
            error: null,
          }),
        })),
      }
    }

    if (table === 'assignments') {
      const baseData = (fixture.assignments ?? [])
        .slice()
        .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))

      const query = {
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: baseData,
          error: null,
        }),
      }
      return {
        select: vi.fn(() => query),
      }
    }

    if (table === 'assignment_docs') {
      return {
        select: vi.fn(() => ({
          in: vi.fn().mockResolvedValue({
            data: fixture.docs ?? [],
            error: null,
          }),
        })),
      }
    }

    if (table === 'quizzes') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({
            data: fixture.quizzes ?? [],
            error: null,
          }),
        })),
      }
    }

    if (table === 'quiz_questions') {
      return {
        select: vi.fn(() => ({
          in: vi.fn().mockResolvedValue({
            data: fixture.quizQuestions ?? [],
            error: null,
          }),
        })),
      }
    }

    if (table === 'quiz_responses') {
      return {
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: fixture.quizResponses ?? [],
              error: null,
            }),
          })),
        })),
      }
    }

    if (table === 'quiz_student_scores') {
      return {
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: fixture.quizOverrides ?? [],
              error: null,
            }),
          })),
        })),
      }
    }

    throw new Error(`Unexpected table in test: ${table}`)
  })
}

describe('GET /api/teacher/gradebook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('excludes draft quizzes from grade calculations', async () => {
    ;(mockSupabaseClient.from as any) = buildMockFrom({
      quizzes: [
        { id: 'quiz-active', title: 'Active Quiz', status: 'active', points_possible: 10, include_in_final: true },
        { id: 'quiz-draft', title: 'Draft Quiz', status: 'draft', points_possible: 10, include_in_final: true },
      ],
      quizQuestions: [
        { id: 'q1', quiz_id: 'quiz-active', correct_option: 0 },
        { id: 'q2', quiz_id: 'quiz-draft', correct_option: 0 },
      ],
      quizResponses: [{ quiz_id: 'quiz-active', question_id: 'q1', student_id: 'student-1', selected_option: 0 }],
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/gradebook?classroom_id=c1')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.students).toHaveLength(1)

    // Draft quiz should be ignored; only active quiz contributes.
    expect(body.students[0].quizzes_percent).toBe(100)
    expect(body.students[0].final_percent).toBe(100)
  })

  it('does not count unattempted active quizzes as zero before they are closed', async () => {
    ;(mockSupabaseClient.from as any) = buildMockFrom({
      quizzes: [{ id: 'quiz-active', title: 'Active Quiz', status: 'active', points_possible: 10, include_in_final: true }],
      quizQuestions: [{ id: 'q1', quiz_id: 'quiz-active', correct_option: 1 }],
      quizResponses: [],
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/gradebook?classroom_id=c1')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.students).toHaveLength(1)

    // No attempt yet means no quiz mark in-progress.
    expect(body.students[0].quizzes_percent).toBeNull()
    expect(body.students[0].final_percent).toBeNull()
  })

  it('returns selected student assignment and quiz breakdown when student_id is provided', async () => {
    ;(mockSupabaseClient.from as any) = buildMockFrom({
      assignments: [{ id: 'a1', title: 'Essay', due_at: '2025-01-01T12:00:00.000Z', position: 2, is_draft: false, points_possible: 30, include_in_final: true }],
      docs: [{ assignment_id: 'a1', student_id: 'student-1', score_completion: 9, score_thinking: 8, score_workflow: 7 }],
      quizzes: [{ id: 'q1', title: 'Quiz 1', status: 'closed', points_possible: 10, include_in_final: true }],
      quizQuestions: [{ id: 'qq1', quiz_id: 'q1', correct_option: 2 }],
      quizResponses: [{ quiz_id: 'q1', question_id: 'qq1', student_id: 'student-1', selected_option: 2 }],
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/gradebook?classroom_id=c1&student_id=student-1')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.selected_student).toBeTruthy()
    expect(body.selected_student.assignments).toEqual([
      {
        assignment_id: 'a1',
        title: 'Essay',
        due_at: '2025-01-01T12:00:00.000Z',
        is_draft: false,
        earned: 24,
        possible: 30,
        percent: 80,
        is_graded: true,
      },
    ])
    expect(body.selected_student.quizzes).toEqual([
      {
        quiz_id: 'q1',
        title: 'Quiz 1',
        earned: 10,
        possible: 10,
        percent: 100,
        status: 'closed',
        is_manual_override: false,
      },
    ])
  })

  it('includes all assignments (graded/ungraded/future) in selected student details by assignment order', async () => {
    ;(mockSupabaseClient.from as any) = buildMockFrom({
      assignments: [
        { id: 'a-graded', title: 'Past Due Graded', due_at: '2025-01-01T12:00:00.000Z', position: 2, is_draft: false, points_possible: 30, include_in_final: true },
        { id: 'a-ungraded', title: 'Past Due Ungraded', due_at: '2025-01-02T12:00:00.000Z', position: 1, is_draft: false, points_possible: 30, include_in_final: true },
        { id: 'a-future', title: 'Future Assignment', due_at: '2099-01-01T12:00:00.000Z', position: 3, is_draft: false, points_possible: 30, include_in_final: true },
        { id: 'a-draft', title: 'Draft Assignment', due_at: '2025-01-03T12:00:00.000Z', position: 4, is_draft: true, points_possible: 30, include_in_final: true },
      ],
      docs: [{ assignment_id: 'a-graded', student_id: 'student-1', score_completion: 10, score_thinking: 10, score_workflow: 10 }],
      quizzes: [],
      quizQuestions: [],
      quizResponses: [],
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/gradebook?classroom_id=c1&student_id=student-1')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.selected_student.assignments).toEqual([
      {
        assignment_id: 'a-ungraded',
        title: 'Past Due Ungraded',
        due_at: '2025-01-02T12:00:00.000Z',
        is_draft: false,
        earned: null,
        possible: 30,
        percent: null,
        is_graded: false,
      },
      {
        assignment_id: 'a-graded',
        title: 'Past Due Graded',
        due_at: '2025-01-01T12:00:00.000Z',
        is_draft: false,
        earned: 30,
        possible: 30,
        percent: 100,
        is_graded: true,
      },
      {
        assignment_id: 'a-future',
        title: 'Future Assignment',
        due_at: '2099-01-01T12:00:00.000Z',
        is_draft: false,
        earned: null,
        possible: 30,
        percent: null,
        is_graded: false,
      },
      {
        assignment_id: 'a-draft',
        title: 'Draft Assignment',
        due_at: '2025-01-03T12:00:00.000Z',
        is_draft: true,
        earned: null,
        possible: 30,
        percent: null,
        is_graded: false,
      },
    ])
  })

  it('falls back to legacy assignment/quiz columns when gradebook metadata columns are unavailable', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'c1', teacher_id: 'teacher-1', archived_at: null },
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'gradebook_settings') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [{ student_id: 'student-1', users: { email: 'student1@example.com' } }],
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

      if (table === 'assignments') {
        return {
          select: vi.fn((selection: string) => {
            const query = {
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue(
                selection.includes('points_possible')
                  ? { data: null, error: { message: 'column assignments.points_possible does not exist' } }
                  : {
                      data: [{ id: 'a1', title: 'Essay', due_at: '2025-01-01T12:00:00.000Z', position: 1, is_draft: false }],
                      error: null,
                    }
              ),
            }
            return query
          }),
        }
      }

      if (table === 'assignment_docs') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [{ assignment_id: 'a1', student_id: 'student-1', score_completion: 9, score_thinking: 8, score_workflow: 7 }],
              error: null,
            }),
          })),
        }
      }

      if (table === 'quizzes') {
        return {
          select: vi.fn((selection: string) => ({
            eq: vi.fn().mockResolvedValue(
              selection.includes('points_possible')
                ? { data: null, error: { message: 'column quizzes.points_possible does not exist' } }
                : { data: [], error: null }
            ),
          })),
        }
      }

      if (table === 'quiz_questions') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }

      if (table === 'quiz_responses') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => ({
              in: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
          })),
        }
      }

      if (table === 'quiz_student_scores') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => ({
              in: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table in test: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/gradebook?classroom_id=c1')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.totals.assignments).toBe(1)
    expect(body.students[0].assignments_percent).toBe(80)
    expect(body.students[0].final_percent).toBe(80)
  })
})

describe('PATCH /api/teacher/gradebook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows non-100 weights when use_weights is false', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'c1', teacher_id: 'teacher-1', archived_at: null },
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'gradebook_settings') {
        return {
          upsert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { use_weights: false, assignments_weight: 10, quizzes_weight: 20 },
                error: null,
              }),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table in test: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/gradebook', {
      method: 'PATCH',
      body: JSON.stringify({
        classroom_id: 'c1',
        use_weights: false,
        assignments_weight: 10,
        quizzes_weight: 20,
      }),
    })

    const response = await PATCH(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.settings).toEqual({
      use_weights: false,
      assignments_weight: 10,
      quizzes_weight: 20,
    })
  })
})

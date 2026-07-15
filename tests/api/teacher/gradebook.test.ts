import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PATCH } from '@/app/api/teacher/gradebook/route'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))

const mockSupabaseClient = { from: vi.fn() }

type SupabaseReadError = { code?: string; message?: string; details?: string; hint?: string }

type GradebookFixture = {
  enrollments?: Array<{ student_id: string; users: { email: string } }>
  profiles?: Array<{ user_id: string; student_number?: string | null; first_name: string | null; last_name: string | null }>
  profilesError?: SupabaseReadError | null
  assignments?: Array<any>
  docs?: Array<any>
  docsError?: SupabaseReadError | null
  docsTeacherClearedAtError?: SupabaseReadError | null
  quizzes?: Array<any>
  quizQuestions?: Array<any>
  quizQuestionsCorrectOptionError?: SupabaseReadError | null
  quizQuestionsError?: SupabaseReadError | null
  quizResponses?: Array<any>
  quizResponsesError?: SupabaseReadError | null
  quizOverrides?: Array<any>
  quizOverridesError?: SupabaseReadError | null
  tests?: Array<any>
  testsWithMetaError?: SupabaseReadError | null
  testsLegacyError?: SupabaseReadError | null
  testQuestions?: Array<any>
  testQuestionsError?: SupabaseReadError | null
  testResponses?: Array<any>
  testResponsesError?: SupabaseReadError | null
  testAttempts?: Array<any>
  testAttemptsError?: SupabaseReadError | null
  settings?: { use_weights: boolean; assignments_weight: number; quizzes_weight: number; tests_weight?: number } | null
  settingsError?: SupabaseReadError | null
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
              error: fixture.settingsError ?? null,
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
            data: fixture.profilesError
              ? null
              : fixture.profiles ?? [
                  { user_id: 'student-1', student_number: '1001', first_name: 'Student', last_name: 'One' },
                ],
            error: fixture.profilesError ?? null,
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
        select: vi.fn((selection: string) => {
          const selectionError = fixture.docsError ?? (
            selection.includes('teacher_cleared_at') ? fixture.docsTeacherClearedAtError ?? null : null
          )
          return {
            in: vi.fn(() => ({
              in: vi.fn().mockResolvedValue({
                data: selectionError ? null : fixture.docs ?? [],
                error: selectionError,
              }),
            })),
          }
        }),
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
        select: vi.fn((selection: string) => {
          const selectionError = fixture.quizQuestionsError ?? (
            selection.includes('correct_option') ? fixture.quizQuestionsCorrectOptionError ?? null : null
          )
          return {
            in: vi.fn().mockResolvedValue({
              data: selectionError ? null : fixture.quizQuestions ?? [],
              error: selectionError,
            }),
          }
        }),
      }
    }

    if (table === 'quiz_responses') {
      return {
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: fixture.quizResponsesError ? null : fixture.quizResponses ?? [],
              error: fixture.quizResponsesError ?? null,
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
              data: fixture.quizOverridesError ? null : fixture.quizOverrides ?? [],
              error: fixture.quizOverridesError ?? null,
            }),
          })),
        })),
      }
    }

    if (table === 'tests') {
      return {
        select: vi.fn((selection: string) => {
          const error = selection.includes('gradebook_weight')
            ? fixture.testsWithMetaError ?? null
            : fixture.testsLegacyError ?? null
          return {
            eq: vi.fn().mockResolvedValue({
              data: error ? null : fixture.tests ?? [],
              error,
            }),
          }
        }),
      }
    }

    if (table === 'test_questions') {
      return {
        select: vi.fn(() => ({
          in: vi.fn().mockResolvedValue({
            data: fixture.testQuestionsError ? null : fixture.testQuestions ?? [],
            error: fixture.testQuestionsError ?? null,
          }),
        })),
      }
    }

    if (table === 'test_responses') {
      return {
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: fixture.testResponsesError ? null : fixture.testResponses ?? [],
              error: fixture.testResponsesError ?? null,
            }),
          })),
        })),
      }
    }

    if (table === 'test_attempts') {
      return {
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: fixture.testAttemptsError ? null : fixture.testAttempts ?? [],
              error: fixture.testAttemptsError ?? null,
            }),
          })),
        })),
      }
    }

    throw new Error(`Unexpected table in test: ${table}`)
  })
}

type QueryTrace = {
  inCalls: Array<{ table: string; column: string; values: string[] }>
  orderCalls: Array<{ table: string; column: string; ascending?: boolean }>
  rangeCalls: Array<{ table: string; from: number; to: number }>
}

function createTrace(): QueryTrace {
  return { inCalls: [], orderCalls: [], rangeCalls: [] }
}

function buildPagedMockFrom(
  rowsByTable: Record<string, Array<Record<string, any>>>,
  trace: QueryTrace,
  errors: Partial<Record<string, SupabaseReadError>> = {}
) {
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

    const createQuery = () => {
      const filters: Array<{ column: string; values: any[] }> = []
      const orders: Array<{ column: string; ascending: boolean }> = []

      const resolveRows = (from?: number, to?: number) => {
        const error = errors[table]
        if (error) {
          return { data: null, error }
        }

        let rows = [...(rowsByTable[table] || [])]
        for (const filter of filters) {
          rows = rows.filter((row) => filter.values.includes(row[filter.column]))
        }

        for (let index = orders.length - 1; index >= 0; index -= 1) {
          const order = orders[index]
          rows.sort((a, b) => {
            const aValue = a[order.column]
            const bValue = b[order.column]
            const comparison = String(aValue ?? '').localeCompare(String(bValue ?? ''), undefined, { numeric: true })
            return order.ascending ? comparison : -comparison
          })
        }

        const data = from == null || to == null ? rows : rows.slice(from, to + 1)
        return { data, error: null }
      }

      const query: any = {
        eq: vi.fn((column: string, value: any) => {
          filters.push({ column, values: [value] })
          return query
        }),
        in: vi.fn((column: string, values: any[]) => {
          trace.inCalls.push({ table, column, values: [...values] })
          filters.push({ column, values: [...values] })
          return query
        }),
        order: vi.fn((column: string, options?: { ascending?: boolean }) => {
          trace.orderCalls.push({ table, column, ascending: options?.ascending })
          orders.push({ column, ascending: options?.ascending ?? true })
          return query
        }),
        range: vi.fn((from: number, to: number) => {
          trace.rangeCalls.push({ table, from, to })
          return Promise.resolve(resolveRows(from, to))
        }),
        then: (resolve: any, reject: any) => Promise.resolve(resolveRows()).then(resolve, reject),
      }

      return query
    }

    return {
      select: vi.fn(() => createQuery()),
    }
  })
}

describe('GET /api/teacher/gradebook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ignores legacy quiz rows in grade calculations', async () => {
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

    expect(body.students[0].quizzes_percent).toBeNull()
    expect(body.students[0].final_percent).toBeNull()
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

  it('returns selected student assignment breakdown when student_id is provided', async () => {
    ;(mockSupabaseClient.from as any) = buildMockFrom({
      assignments: [{ id: 'a1', title: 'Essay', due_at: '2025-01-01T12:00:00.000Z', position: 2, is_draft: false, points_possible: 30, include_in_final: true }],
      docs: [{ assignment_id: 'a1', student_id: 'student-1', score_completion: 9, score_thinking: 8, score_workflow: 7 }],
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/gradebook?classroom_id=c1&student_id=student-1')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.assessment_columns).toEqual([
      {
        assessment_id: 'a1',
        assessment_type: 'assignment',
        code: 'A1',
        title: 'Essay',
        possible: 30,
        weight: 10,
        due_at: '2025-01-01T12:00:00.000Z',
        is_draft: false,
        include_in_final: true,
      },
    ])
    expect(body.students[0].student_number).toBe('1001')
    expect(body.students[0].assessment_scores).toEqual([
      {
        assessment_id: 'a1',
        assessment_type: 'assignment',
        earned: 24,
        possible: 30,
        percent: 80,
        is_graded: true,
      },
    ])
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
    expect(body.selected_student.quizzes).toEqual([])
    expect(body.selected_student.tests).toEqual([])
  })

  it('includes fully scored tests in grade calculations and class summary', async () => {
    ;(mockSupabaseClient.from as any) = buildMockFrom({
      tests: [{ id: 't1', title: 'Unit Test', status: 'closed', include_in_final: true }],
      testQuestions: [
        { id: 'tq1', test_id: 't1', points: 5 },
        { id: 'tq2', test_id: 't1', points: 5 },
      ],
      testResponses: [
        { test_id: 't1', question_id: 'tq1', student_id: 'student-1', score: 5 },
        { test_id: 't1', question_id: 'tq2', student_id: 'student-1', score: 3 },
      ],
      testAttempts: [{ test_id: 't1', student_id: 'student-1', is_submitted: true }],
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/gradebook?classroom_id=c1&student_id=student-1')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.students[0].tests_percent).toBe(80)
    expect(body.students[0].final_percent).toBe(80)
    expect(body.selected_student.tests).toEqual([
      {
        test_id: 't1',
        title: 'Unit Test',
        earned: 8,
        possible: 10,
        percent: 80,
        status: 'closed',
      },
    ])
    expect(body.class_summary.tests).toEqual([
      {
        test_id: 't1',
        title: 'Unit Test',
        status: 'closed',
        possible: 10,
        scored_count: 1,
        average_percent: 80,
      },
    ])
    expect(body.totals.tests).toBe(1)
  })

  it('adds sparse per-student assessment statuses for the inspector', async () => {
    ;(mockSupabaseClient.from as any) = buildMockFrom({
      assignments: [
        { id: 'a-missing', title: 'Missing Assignment', due_at: '2025-01-01T12:00:00.000Z', position: 1, is_draft: false, points_possible: 30, include_in_final: true },
        { id: 'a-submitted', title: 'Submitted Assignment', due_at: '2099-01-01T12:00:00.000Z', position: 2, is_draft: false, points_possible: 30, include_in_final: true },
      ],
      docs: [
        {
          assignment_id: 'a-submitted',
          student_id: 'student-1',
          score_completion: null,
          score_thinking: null,
          score_workflow: null,
          is_submitted: true,
          submitted_at: '2026-01-01T12:00:00.000Z',
        },
      ],
      tests: [{ id: 't-submitted', title: 'Submitted Test', status: 'active', include_in_final: true }],
      testQuestions: [{ id: 'tq1', test_id: 't-submitted', points: 5 }],
      testResponses: [],
      testAttempts: [{ test_id: 't-submitted', student_id: 'student-1', is_submitted: true, submitted_at: '2026-01-01T12:00:00.000Z' }],
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/gradebook?classroom_id=c1')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.students[0].assessment_scores).toEqual([
      expect.objectContaining({ assessment_id: 'a-missing', status: 'missing' }),
      expect.objectContaining({ assessment_id: 'a-submitted', status: 'submitted' }),
      expect.objectContaining({ assessment_id: 't-submitted', status: 'submitted' }),
    ])
  })

  it('uses assessment weights separately from points possible in final calculations', async () => {
    ;(mockSupabaseClient.from as any) = buildMockFrom({
      assignments: [
        {
          id: 'a-heavy-points',
          title: 'Large Raw Scale',
          due_at: '2025-01-01T12:00:00.000Z',
          position: 1,
          is_draft: false,
          points_possible: 100,
          include_in_final: true,
          gradebook_weight: 10,
        },
        {
          id: 'a-small-points',
          title: 'Small Raw Scale',
          due_at: '2025-01-02T12:00:00.000Z',
          position: 2,
          is_draft: false,
          points_possible: 10,
          include_in_final: true,
          gradebook_weight: 10,
        },
      ],
      docs: [
        { assignment_id: 'a-heavy-points', student_id: 'student-1', score_completion: 10, score_thinking: 10, score_workflow: 10 },
        { assignment_id: 'a-small-points', student_id: 'student-1', score_completion: 0, score_thinking: 0, score_workflow: 0 },
      ],
      quizzes: [],
      quizQuestions: [],
      quizResponses: [],
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/gradebook?classroom_id=c1')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.assessment_columns).toEqual([
      expect.objectContaining({
        assessment_id: 'a-heavy-points',
        possible: 100,
        weight: 10,
      }),
      expect.objectContaining({
        assessment_id: 'a-small-points',
        possible: 10,
        weight: 10,
      }),
    ])
    expect(body.students[0].assignments_earned).toBe(100)
    expect(body.students[0].assignments_possible).toBe(110)
    expect(body.students[0].assignments_percent).toBe(50)
    expect(body.students[0].final_percent).toBe(50)
  })

  it('ignores legacy category weights and uses assessment weights for final calculations', async () => {
    ;(mockSupabaseClient.from as any) = buildMockFrom({
      settings: { use_weights: true, assignments_weight: 100, quizzes_weight: 0, tests_weight: 0 },
      assignments: [
        {
          id: 'a1',
          title: 'Assignment 1',
          due_at: '2025-01-01T12:00:00.000Z',
          position: 1,
          is_draft: false,
          points_possible: 10,
          include_in_final: true,
          gradebook_weight: 10,
        },
      ],
      docs: [
        { assignment_id: 'a1', student_id: 'student-1', score_completion: 10, score_thinking: 10, score_workflow: 10 },
      ],
      quizzes: [
        {
          id: 'q1',
          title: 'Quiz 1',
          status: 'closed',
          points_possible: 1,
          include_in_final: true,
          gradebook_weight: 10,
        },
      ],
      quizQuestions: [{ id: 'qq1', quiz_id: 'q1', correct_option: 0 }],
      quizResponses: [{ quiz_id: 'q1', question_id: 'qq1', student_id: 'student-1', selected_option: 1 }],
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/gradebook?classroom_id=c1')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.students[0].assignments_percent).toBe(100)
    expect(body.students[0].quizzes_percent).toBeNull()
    expect(body.students[0].final_percent).toBe(100)
  })

  it('does not load legacy category settings for gradebook calculations', async () => {
    ;(mockSupabaseClient.from as any) = buildMockFrom({
      settingsError: { message: 'database unavailable' },
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/gradebook?classroom_id=c1')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.settings).toEqual({
      use_weights: false,
      assignments_weight: 50,
      quizzes_weight: 20,
      tests_weight: 30,
    })
    expect(mockSupabaseClient.from).not.toHaveBeenCalledWith('gradebook_settings')
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

  it('returns assignment average and median in class summary', async () => {
    ;(mockSupabaseClient.from as any) = buildMockFrom({
      enrollments: [
        { student_id: 'student-1', users: { email: 'student1@example.com' } },
        { student_id: 'student-2', users: { email: 'student2@example.com' } },
      ],
      profiles: [
        { user_id: 'student-1', first_name: 'Student', last_name: 'One' },
        { user_id: 'student-2', first_name: 'Student', last_name: 'Two' },
      ],
      assignments: [
        { id: 'a1', title: 'Essay', due_at: '2025-01-01T12:00:00.000Z', position: 1, is_draft: false, points_possible: 30, include_in_final: true },
      ],
      docs: [
        { assignment_id: 'a1', student_id: 'student-1', score_completion: 2, score_thinking: 2, score_workflow: 2 }, // 20%
        { assignment_id: 'a1', student_id: 'student-2', score_completion: 5, score_thinking: 5, score_workflow: 5 }, // 50%
      ],
      quizzes: [],
      quizQuestions: [],
      quizResponses: [],
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/gradebook?classroom_id=c1')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.class_summary.assignments).toHaveLength(1)
    expect(body.class_summary.assignments[0]).toMatchObject({
      assignment_id: 'a1',
      average_percent: 35,
      median_percent: 35,
      graded_count: 2,
    })
  })

  it('excludes unenrolled students from class assignment summary aggregates', async () => {
    ;(mockSupabaseClient.from as any) = buildMockFrom({
      enrollments: [{ student_id: 'student-1', users: { email: 'student1@example.com' } }],
      profiles: [{ user_id: 'student-1', first_name: 'Student', last_name: 'One' }],
      assignments: [
        { id: 'a1', title: 'Essay', due_at: '2025-01-01T12:00:00.000Z', position: 1, is_draft: false, points_possible: 30, include_in_final: true },
      ],
      docs: [
        { assignment_id: 'a1', student_id: 'student-1', score_completion: 3, score_thinking: 3, score_workflow: 3 }, // 30%
        { assignment_id: 'a1', student_id: 'withdrawn-student', score_completion: 10, score_thinking: 10, score_workflow: 10 }, // 100% (must be ignored)
      ],
      quizzes: [],
      quizQuestions: [],
      quizResponses: [],
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/gradebook?classroom_id=c1')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.class_summary.total_students).toBe(1)
    expect(body.class_summary.assignments[0]).toMatchObject({
      assignment_id: 'a1',
      graded_count: 1,
      average_percent: 30,
      median_percent: 30,
    })
  })

  it('chunks large gradebook filters and scopes assignment docs to enrolled students', async () => {
    const trace = createTrace()
    const studentIds = Array.from({ length: 51 }, (_, index) => `student-${String(index + 1).padStart(2, '0')}`)
    const assignments = Array.from({ length: 51 }, (_, index) => ({
      id: `assignment-${String(index + 1).padStart(2, '0')}`,
      classroom_id: 'c1',
      title: `Assignment ${index + 1}`,
      due_at: '2025-01-01T12:00:00.000Z',
      position: index + 1,
      is_draft: false,
      points_possible: 30,
      include_in_final: true,
      gradebook_weight: 10,
    }))
    const quizzes = Array.from({ length: 51 }, (_, index) => ({
      id: `quiz-${String(index + 1).padStart(2, '0')}`,
      classroom_id: 'c1',
      title: `Quiz ${index + 1}`,
      status: 'closed',
      position: index + 1,
      points_possible: 10,
      include_in_final: true,
      gradebook_weight: 10,
    }))
    const tests = Array.from({ length: 51 }, (_, index) => ({
      id: `test-${String(index + 1).padStart(2, '0')}`,
      classroom_id: 'c1',
      title: `Test ${index + 1}`,
      status: 'closed',
      position: index + 1,
      include_in_final: true,
      gradebook_weight: 10,
    }))

    ;(mockSupabaseClient.from as any) = buildPagedMockFrom({
      classroom_enrollments: studentIds.map((studentId, index) => ({
        id: `enrollment-${String(index + 1).padStart(2, '0')}`,
        classroom_id: 'c1',
        student_id: studentId,
        users: { email: `${studentId}@example.com` },
      })),
      student_profiles: studentIds.map((studentId, index) => ({
        id: `profile-${String(index + 1).padStart(2, '0')}`,
        user_id: studentId,
        student_number: String(1000 + index),
        first_name: 'Student',
        last_name: String(index + 1),
      })),
      assignments,
      assignment_docs: [
        {
          id: 'doc-first',
          assignment_id: assignments[0].id,
          student_id: studentIds[0],
          score_completion: 3,
          score_thinking: 3,
          score_workflow: 3,
        },
        {
          id: 'doc-last',
          assignment_id: assignments[50].id,
          student_id: studentIds[50],
          score_completion: 6,
          score_thinking: 6,
          score_workflow: 6,
        },
        {
          id: 'doc-withdrawn',
          assignment_id: assignments[0].id,
          student_id: 'withdrawn-student',
          score_completion: 10,
          score_thinking: 10,
          score_workflow: 10,
        },
      ],
      quizzes,
      quiz_questions: [
        { id: 'quiz-question-first', quiz_id: quizzes[0].id, correct_option: 1 },
        { id: 'quiz-question-last', quiz_id: quizzes[50].id, correct_option: 1 },
      ],
      quiz_responses: [
        { id: 'quiz-response-first', quiz_id: quizzes[0].id, question_id: 'quiz-question-first', student_id: studentIds[0], selected_option: 1 },
        { id: 'quiz-response-last', quiz_id: quizzes[50].id, question_id: 'quiz-question-last', student_id: studentIds[50], selected_option: 1 },
      ],
      quiz_student_scores: [
        { id: 'quiz-override-last', quiz_id: quizzes[50].id, student_id: studentIds[50], manual_override_score: 9 },
      ],
      tests,
      test_questions: [
        { id: 'test-question-first', test_id: tests[0].id, points: 5 },
        { id: 'test-question-last', test_id: tests[50].id, points: 5 },
      ],
      test_responses: [
        { id: 'test-response-first', test_id: tests[0].id, question_id: 'test-question-first', student_id: studentIds[0], score: 5 },
        { id: 'test-response-last', test_id: tests[50].id, question_id: 'test-question-last', student_id: studentIds[50], score: 4 },
      ],
      test_attempts: [
        { id: 'test-attempt-first', test_id: tests[0].id, student_id: studentIds[0], is_submitted: true },
        { id: 'test-attempt-last', test_id: tests[50].id, student_id: studentIds[50], is_submitted: true },
      ],
    }, trace)

    const request = new NextRequest('http://localhost:3000/api/teacher/gradebook?classroom_id=c1')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(trace.inCalls.every((call) => call.values.length <= 50)).toBe(true)

    const assignmentStudentFilters = trace.inCalls.filter((call) =>
      call.table === 'assignment_docs' && call.column === 'student_id'
    )
    expect(assignmentStudentFilters.length).toBeGreaterThan(0)
    expect(assignmentStudentFilters.some((call) => call.values.includes(studentIds[0]))).toBe(true)
    expect(assignmentStudentFilters.some((call) => call.values.includes(studentIds[50]))).toBe(true)
    expect(assignmentStudentFilters.every((call) => !call.values.includes('withdrawn-student'))).toBe(true)
    expect(body.class_summary.assignments[0]).toMatchObject({
      assignment_id: assignments[0].id,
      graded_count: 1,
      average_percent: 30,
    })
  })

  it('paginates large gradebook related rows with stable ordering', async () => {
    const trace = createTrace()
    const studentIds = Array.from({ length: 50 }, (_, index) => `student-${String(index + 1).padStart(2, '0')}`)
    const assignments = Array.from({ length: 50 }, (_, index) => ({
      id: `assignment-${String(index + 1).padStart(2, '0')}`,
      classroom_id: 'c1',
      title: `Assignment ${index + 1}`,
      due_at: '2025-01-01T12:00:00.000Z',
      position: index + 1,
      is_draft: false,
      points_possible: 30,
      include_in_final: true,
      gradebook_weight: 10,
    }))
    const docs = assignments.flatMap((assignment, assignmentIndex) =>
      studentIds.map((studentId, studentIndex) => ({
        id: `doc-${String(assignmentIndex + 1).padStart(2, '0')}-${String(studentIndex + 1).padStart(2, '0')}`,
        assignment_id: assignment.id,
        student_id: studentId,
        score_completion: 10,
        score_thinking: 10,
        score_workflow: 10,
      }))
    )

    ;(mockSupabaseClient.from as any) = buildPagedMockFrom({
      classroom_enrollments: studentIds.map((studentId, index) => ({
        id: `enrollment-${String(index + 1).padStart(2, '0')}`,
        classroom_id: 'c1',
        student_id: studentId,
        users: { email: `${studentId}@example.com` },
      })),
      student_profiles: [],
      assignments,
      assignment_docs: docs,
      quizzes: [],
      quiz_questions: [],
      quiz_responses: [],
      quiz_student_scores: [],
      tests: [],
      test_questions: [],
      test_responses: [],
      test_attempts: [],
    }, trace)

    const request = new NextRequest('http://localhost:3000/api/teacher/gradebook?classroom_id=c1')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.class_summary.assignments[0].graded_count).toBe(50)
    expect(body.class_summary.assignments[49].graded_count).toBe(50)
    expect(trace.orderCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'assignment_docs', column: 'id' }),
    ]))
    expect(trace.rangeCalls).toEqual(expect.arrayContaining([
      { table: 'assignment_docs', from: 0, to: 999 },
      { table: 'assignment_docs', from: 1000, to: 1999 },
      { table: 'assignment_docs', from: 2000, to: 2999 },
    ]))
  })

  it('finds a selected enrolled student beyond the first roster page', async () => {
    const trace = createTrace()
    const studentIds = Array.from({ length: 1001 }, (_, index) => `student-${String(index + 1).padStart(4, '0')}`)
    const selectedStudentId = studentIds[1000]

    ;(mockSupabaseClient.from as any) = buildPagedMockFrom({
      classroom_enrollments: studentIds.map((studentId, index) => ({
        id: `enrollment-${String(index + 1).padStart(4, '0')}`,
        classroom_id: 'c1',
        student_id: studentId,
        users: { email: `${studentId}@example.com` },
      })),
      student_profiles: [],
      assignments: [],
      assignment_docs: [],
      quizzes: [],
      quiz_questions: [],
      quiz_responses: [],
      quiz_student_scores: [],
      tests: [],
      test_questions: [],
      test_responses: [],
      test_attempts: [],
    }, trace)

    const request = new NextRequest(`http://localhost:3000/api/teacher/gradebook?classroom_id=c1&student_id=${selectedStudentId}`)
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.class_summary.total_students).toBe(1001)
    expect(body.selected_student.student_id).toBe(selectedStudentId)
    expect(trace.rangeCalls).toEqual(expect.arrayContaining([
      { table: 'classroom_enrollments', from: 0, to: 999 },
      { table: 'classroom_enrollments', from: 1000, to: 1999 },
    ]))
  })

  it('returns 500 when gradebook related rows fail to load', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(mockSupabaseClient.from as any) = buildMockFrom({
      assignments: [
        { id: 'a1', title: 'Essay', due_at: '2025-01-01T12:00:00.000Z', position: 1, is_draft: false, points_possible: 30, include_in_final: true },
      ],
      docsError: { message: 'database unavailable' },
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/gradebook?classroom_id=c1')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('Failed to load assignment docs for gradebook')
    consoleError.mockRestore()
  })

  it('falls back when assignment doc teacher_cleared_at is not migrated yet', async () => {
    ;(mockSupabaseClient.from as any) = buildMockFrom({
      assignments: [
        { id: 'a1', title: 'Essay', due_at: '2025-01-01T12:00:00.000Z', position: 1, is_draft: false, points_possible: 30, include_in_final: true },
      ],
      docs: [
        { assignment_id: 'a1', student_id: 'student-1', score_completion: 9, score_thinking: 8, score_workflow: 7 },
      ],
      docsTeacherClearedAtError: {
        code: '42703',
        message: 'column assignment_docs.teacher_cleared_at does not exist',
      },
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/gradebook?classroom_id=c1')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.students[0].assignments_percent).toBe(80)
    expect(body.students[0].final_percent).toBe(80)
  })

  it('keeps missing optional test tables as an empty test breakdown', async () => {
    ;(mockSupabaseClient.from as any) = buildMockFrom({
      tests: [{ id: 't1', title: 'Unit Test', status: 'closed', include_in_final: true }],
      testQuestionsError: { code: 'PGRST205', message: 'Could not find the table public.test_questions' },
      testResponsesError: { code: 'PGRST205', message: 'Could not find the table public.test_responses' },
      testAttemptsError: { code: 'PGRST205', message: 'Could not find the table public.test_attempts' },
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/gradebook?classroom_id=c1')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.totals.tests).toBe(1)
    expect(body.students[0].tests_percent).toBeNull()
    expect(body.class_summary.tests).toEqual([
      {
        test_id: 't1',
        title: 'Unit Test',
        status: 'closed',
        possible: 0,
        scored_count: 0,
        average_percent: null,
      },
    ])
  })

  it('does not hide tests when a partial migration leaves fallback columns unavailable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(mockSupabaseClient.from as any) = buildMockFrom({
      testsWithMetaError: {
        code: '42703',
        message: 'column tests.gradebook_weight does not exist',
      },
      testsLegacyError: {
        code: '42703',
        message: 'column tests.include_in_final does not exist',
      },
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/gradebook?classroom_id=c1')
    const response = await GET(request)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to load tests for gradebook' })
    consoleError.mockRestore()
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
            in: vi.fn(() => {
              return {
                in: vi.fn().mockResolvedValue({
                  data: [{ assignment_id: 'a1', student_id: 'student-1', score_completion: 9, score_thinking: 8, score_workflow: 7 }],
                  error: null,
                }),
              }
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

      if (table === 'tests') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }

      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }

      if (table === 'test_responses') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => ({
              in: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
          })),
        }
      }

      if (table === 'test_attempts') {
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

  it.each([
    ['{', 'Invalid JSON body'],
    [JSON.stringify(null), 'classroom_id is required'],
    [JSON.stringify({ classroom_id: 'c1' }), 'No gradebook update provided'],
    [JSON.stringify({
      classroom_id: 'c1',
      assessment_type: 'quiz',
      assessment_id: 'q1',
      gradebook_weight: 10,
    }), 'assessment_type must be assignment or test'],
    [JSON.stringify({
      classroom_id: 'c1',
      assessment_type: 'test',
      assessment_id: 't1',
      gradebook_weight: 1000,
    }), 'gradebook_weight must be an integer 1-999'],
    [JSON.stringify({
      classroom_id: 'c1',
      assessment_type: false,
      assessment_id: 't1',
      gradebook_weight: 10,
    }), 'assessment_type must be assignment or test'],
    [JSON.stringify({
      classroom_id: 'c1',
      assessment_type: 'test',
      assessment_id: [],
      gradebook_weight: 10,
    }), 'assessment_id is required'],
    [JSON.stringify({
      classroom_id: 'c1',
      assessment_type: 'test',
      assessment_id: '',
      gradebook_weight: 10,
    }), 'assessment_id is required'],
    [JSON.stringify({
      classroom_id: 'c1',
      assessment_type: 'test',
      assessment_id: 't1',
      gradebook_weight: true,
    }), 'gradebook_weight must be an integer 1-999'],
    [JSON.stringify({
      classroom_id: 'c1',
      assessment_type: 'test',
      assessment_id: 't1',
      gradebook_weight: 0,
    }), 'gradebook_weight must be an integer 1-999'],
    [JSON.stringify({
      classroom_id: 'c1',
      assessment_type: 'test',
      assessment_id: 't1',
      gradebook_weight: { value: 10 },
    }), 'gradebook_weight must be an integer 1-999'],
  ])('returns 400 for invalid update input %#', async (body, message) => {
    const request = new NextRequest('http://localhost:3000/api/teacher/gradebook', {
      method: 'PATCH',
      body,
    })

    const response = await PATCH(request)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: message })
  })

  it('rejects legacy category settings updates', async () => {
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

      throw new Error(`Unexpected table in test: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/gradebook', {
      method: 'PATCH',
      body: JSON.stringify({
        classroom_id: 'c1',
        assessment_type: null,
        assessment_id: null,
        gradebook_weight: null,
        use_weights: false,
        assignments_weight: 10,
        quizzes_weight: 20,
        tests_weight: 30,
      }),
    })

    const response = await PATCH(request)
    const body = await response.json()

    expect(response.status).toBe(410)
    expect(body.error).toBe('Category gradebook weights are retired; update assessment weights instead')
    expect(mockSupabaseClient.from).not.toHaveBeenCalledWith('gradebook_settings')
  })

  it('updates an individual assessment weight', async () => {
    const update = vi.fn(() => ({
      eq: vi.fn().mockReturnThis(),
      select: vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'a1', gradebook_weight: 20 },
          error: null,
        }),
      })),
    }))

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

      if (table === 'assignments') {
        return { update }
      }

      throw new Error(`Unexpected table in test: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/gradebook', {
      method: 'PATCH',
      body: JSON.stringify({
        classroom_id: 'c1',
        assessment_type: 'assignment',
        assessment_id: 'a1',
        gradebook_weight: '20',
        assignments_weight: 50,
      }),
    })

    const response = await PATCH(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith({ gradebook_weight: 20 })
    expect(body.assessment).toEqual({
      assessment_id: 'a1',
      assessment_type: 'assignment',
      weight: 20,
    })
  })

  it('rejects assessment weight updates for archived classrooms', async () => {
    const update = vi.fn()

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'c1', teacher_id: 'teacher-1', archived_at: '2026-05-01T12:00:00.000Z' },
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'assignments') {
        return { update }
      }

      throw new Error(`Unexpected table in test: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/gradebook', {
      method: 'PATCH',
      body: JSON.stringify({
        classroom_id: 'c1',
        assessment_type: 'assignment',
        assessment_id: 'a1',
        gradebook_weight: 20,
      }),
    })

    const response = await PATCH(request)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toBe('Classroom is archived')
    expect(update).not.toHaveBeenCalled()
    expect(mockSupabaseClient.from).not.toHaveBeenCalledWith('assignments')
  })
})

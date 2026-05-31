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

type TestResponseFixture = { student_id: string } & Record<string, unknown>

type QueryLog = {
  inCalls: Array<{ table: string; column: string; values: string[] }>
  orderCalls: Array<{ table: string; column: string }>
  rangeCalls: Array<{ table: string; from: number; to: number }>
}

type ChunkedTableOptions = {
  table?: string
  log?: QueryLog
  errorForSelect?: (columns: string) => any
  onIn?: (column: string, values: string[]) => void
}

function createQueryLog(): QueryLog {
  return { inCalls: [], orderCalls: [], rangeCalls: [] }
}

function mockChunkedTable(
  rows: Array<Record<string, any>>,
  options: ChunkedTableOptions = {},
) {
  return {
    select: vi.fn((columns: string) => {
      const filters: Array<{ column: string; values: string[] }> = []
      const query: any = {
        in: vi.fn((column: string, values: string[]) => {
          filters.push({ column, values })
          if (options.table) {
            options.log?.inCalls.push({ table: options.table, column, values })
          }
          options.onIn?.(column, values)
          return query
        }),
        order: vi.fn((column: string) => {
          if (options.table) {
            options.log?.orderCalls.push({ table: options.table, column })
          }
          return query
        }),
        range: vi.fn((from: number, to: number) => {
          if (options.table) {
            options.log?.rangeCalls.push({ table: options.table, from, to })
          }
          const error = options.errorForSelect?.(columns)
          if (error) {
            return Promise.resolve({ data: null, error })
          }

          const filteredRows = rows.filter((row) =>
            filters.every((filter) => filter.values.includes(String(row[filter.column])))
          )

          return Promise.resolve({
            data: filteredRows.slice(from, to + 1),
            error: null,
          })
        }),
      }
      return query
    }),
  }
}

function mockTestResponsesQuery(
  rows: TestResponseFixture[],
  onStudentIds?: (studentIds: string[]) => void
) {
  return mockChunkedTable(rows, {
    table: 'test_responses',
    onIn: (column, values) => {
      if (column === 'student_id') onStudentIds?.(values)
    },
  })
}

function mockUsersQuery(rows: Array<Record<string, any>>, log?: QueryLog) {
  return mockChunkedTable(rows, { table: 'users', log })
}

function mockProfilesQuery(rows: Array<Record<string, any>>, log?: QueryLog) {
  return mockChunkedTable(rows, { table: 'student_profiles', log })
}

function mockFocusEventsQuery(rows: Array<Record<string, any>> = [], log?: QueryLog) {
  return mockChunkedTable(rows, { table: 'test_focus_events', log })
}

function mockEnrollmentQuery(studentIds: string[], log?: QueryLog) {
  return {
    select: vi.fn(() => {
      const query: any = {
        eq: vi.fn(() => query),
        order: vi.fn((column: string) => {
          log?.orderCalls.push({ table: 'classroom_enrollments', column })
          return query
        }),
        range: vi.fn((from: number, to: number) => {
          log?.rangeCalls.push({ table: 'classroom_enrollments', from, to })
          return Promise.resolve({
            data: studentIds.slice(from, to + 1).map((student_id) => ({ student_id })),
            count: studentIds.length,
            error: null,
          })
        }),
      }
      return query
    }),
  }
}

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
        return mockTestResponsesQuery([
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
        ])
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
        return mockChunkedTable(
          [
            {
              test_id: 'test-1',
              student_id: 'student-1',
              is_submitted: true,
              submitted_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
          ],
          {
            errorForSelect: (columns) =>
              columns.includes('returned_at')
                ? {
                    code: 'PGRST204',
                    message: "Could not find column 'returned_at'",
                  }
                : null,
          },
        )
      }

      if (table === 'users') {
        return mockUsersQuery([{ id: 'student-1', email: 'student1@example.com' }])
      }

      if (table === 'student_profiles') {
        return mockProfilesQuery([{ id: 'profile-1', user_id: 'student-1', first_name: 'Student', last_name: 'One' }])
      }

      if (table === 'test_focus_events') {
        return mockFocusEventsQuery()
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

  it('ignores unenrolled response rows in result aggregates and open-response counts', async () => {
    let testResponseStudentIds: string[] | null = null

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'question-mc-1',
                  test_id: 'test-1',
                  question_type: 'multiple_choice',
                  question_text: '2 + 2 = ?',
                  options: ['4', '5'],
                  correct_option: 0,
                  points: 1,
                  response_max_chars: 5000,
                  position: 0,
                },
                {
                  id: 'question-open-1',
                  test_id: 'test-1',
                  question_type: 'open_response',
                  question_text: 'Explain your process',
                  options: [],
                  correct_option: null,
                  points: 5,
                  response_max_chars: 5000,
                  position: 1,
                },
              ],
              error: null,
            }),
          })),
        }
      }

      if (table === 'test_responses') {
        return mockTestResponsesQuery(
          [
            {
              id: 'response-enrolled-mc',
              test_id: 'test-1',
              question_id: 'question-mc-1',
              student_id: 'student-1',
              selected_option: 0,
              response_text: null,
              score: 1,
              feedback: null,
              graded_at: null,
              graded_by: null,
              submitted_at: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'response-enrolled-open',
              test_id: 'test-1',
              question_id: 'question-open-1',
              student_id: 'student-1',
              selected_option: null,
              response_text: 'Partially answered',
              score: null,
              feedback: null,
              graded_at: null,
              graded_by: null,
              submitted_at: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'response-outside-mc',
              test_id: 'test-1',
              question_id: 'question-mc-1',
              student_id: 'student-outside',
              selected_option: 1,
              response_text: null,
              score: 0,
              feedback: null,
              graded_at: null,
              graded_by: null,
              submitted_at: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'response-outside-open',
              test_id: 'test-1',
              question_id: 'question-open-1',
              student_id: 'student-outside',
              selected_option: null,
              response_text: 'Outside response',
              score: 5,
              feedback: 'Good',
              graded_at: '2026-01-01T00:10:00.000Z',
              graded_by: 'teacher-1',
              submitted_at: '2026-01-01T00:00:00.000Z',
            },
          ],
          (studentIds) => {
            testResponseStudentIds = studentIds
          }
        )
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
        return mockChunkedTable([
          {
            test_id: 'test-1',
            student_id: 'student-1',
            is_submitted: true,
            submitted_at: '2026-01-01T00:00:00.000Z',
            returned_at: null,
            returned_by: null,
            closed_for_grading_at: null,
            closed_for_grading_by: null,
            updated_at: '2026-01-01T00:00:00.000Z',
            responses: null,
          },
        ])
      }

      if (table === 'users') {
        return mockUsersQuery([{ id: 'student-1', email: 'student1@example.com' }])
      }

      if (table === 'student_profiles') {
        return mockProfilesQuery([{ id: 'profile-1', user_id: 'student-1', first_name: 'Student', last_name: 'One' }])
      }

      if (table === 'test_focus_events') {
        return mockFocusEventsQuery()
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/results'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(testResponseStudentIds).toEqual(['student-1'])
    expect(data.students).toHaveLength(1)
    expect(data.students[0].student_id).toBe('student-1')
    expect(data.students[0].answers).not.toHaveProperty('student-outside')
    expect(data.students[0].graded_open_responses).toBe(0)
    expect(data.students[0].ungraded_open_responses).toBe(1)
    expect(data.results).toEqual([
      expect.objectContaining({
        question_id: 'question-mc-1',
        counts: [1, 0],
        total_responses: 1,
      }),
    ])
    expect(data.stats.graded_open_responses).toBe(0)
    expect(data.stats.ungraded_open_responses).toBe(1)
    expect(data.stats.total_students).toBe(1)
  })

  it('paginates classroom enrollments so students beyond the first page are included', async () => {
    const log = createQueryLog()
    const studentIds = Array.from({ length: 1001 }, (_, index) =>
      `student-${String(index + 1).padStart(4, '0')}`
    )

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
      if (table === 'classroom_enrollments') return mockEnrollmentQuery(studentIds, log)
      if (table === 'test_responses') return mockChunkedTable([], { table, log })
      if (table === 'test_attempts') return mockChunkedTable([], { table, log })
      if (table === 'users') return mockUsersQuery([], log)
      if (table === 'student_profiles') return mockProfilesQuery([], log)
      if (table === 'test_focus_events') return mockFocusEventsQuery([], log)
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/results'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.stats.total_students).toBe(1001)
    expect(data.students).toHaveLength(1001)
    expect(data.students.some((student: { student_id: string }) => student.student_id === 'student-1001')).toBe(true)
    expect(log.rangeCalls).toContainEqual({ table: 'classroom_enrollments', from: 0, to: 999 })
    expect(log.rangeCalls).toContainEqual({ table: 'classroom_enrollments', from: 1000, to: 1999 })
  })

  it('chunks and paginates test result reads for large rosters', async () => {
    const log = createQueryLog()
    const studentIds = Array.from({ length: 51 }, (_, index) =>
      `student-${String(index + 1).padStart(3, '0')}`
    )
    const questions = Array.from({ length: 25 }, (_, index) => ({
      id: `question-${String(index + 1).padStart(2, '0')}`,
      test_id: 'test-1',
      question_type: 'multiple_choice',
      question_text: `Question ${index + 1}`,
      options: ['A', 'B'],
      correct_option: 0,
      points: 1,
      response_max_chars: 5000,
      position: index,
    }))
    const responseRows = studentIds.flatMap((studentId) =>
      questions.map((question) => ({
        id: `response-${studentId}-${question.id}`,
        test_id: 'test-1',
        question_id: question.id,
        student_id: studentId,
        selected_option: 0,
        response_text: null,
        score: 1,
        feedback: null,
        graded_at: null,
        graded_by: null,
        submitted_at: '2026-01-01T00:00:00.000Z',
      }))
    )
    const attemptRows = studentIds.map((studentId) => ({
      id: `attempt-${studentId}`,
      test_id: 'test-1',
      student_id: studentId,
      is_submitted: true,
      submitted_at: '2026-01-01T00:00:00.000Z',
      returned_at: null,
      returned_by: null,
      closed_for_grading_at: null,
      closed_for_grading_by: null,
      updated_at: '2026-01-01T00:00:00.000Z',
      responses: null,
    }))
    const userRows = studentIds.map((studentId) => ({
      id: studentId,
      email: `${studentId}@example.com`,
    }))
    const profileRows = studentIds.map((studentId) => ({
      id: `profile-${studentId}`,
      user_id: studentId,
      first_name: 'Student',
      last_name: studentId.slice('student-'.length),
    }))
    const focusRows = studentIds.map((studentId) => ({
      id: `focus-${studentId}`,
      test_id: 'test-1',
      student_id: studentId,
      event_type: 'route_exit_attempt',
      occurred_at: '2026-01-01T00:05:00.000Z',
    }))
    const availabilityRows = studentIds.map((studentId) => ({
      id: `availability-${studentId}`,
      test_id: 'test-1',
      student_id: studentId,
      state: 'closed',
    }))

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: questions, error: null }),
          })),
        }
      }
      if (table === 'classroom_enrollments') return mockEnrollmentQuery(studentIds, log)
      if (table === 'test_responses') return mockChunkedTable(responseRows, { table, log })
      if (table === 'test_student_availability') return mockChunkedTable(availabilityRows, { table, log })
      if (table === 'test_attempts') return mockChunkedTable(attemptRows, { table, log })
      if (table === 'users') return mockUsersQuery(userRows, log)
      if (table === 'student_profiles') return mockProfilesQuery(profileRows, log)
      if (table === 'test_focus_events') return mockFocusEventsQuery(focusRows, log)
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/results'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.results).toHaveLength(25)
    expect(data.results[0].total_responses).toBe(51)
    expect(data.stats).toEqual(
      expect.objectContaining({
        total_students: 51,
        responded: 51,
      }),
    )

    for (const table of [
      'test_responses',
      'test_student_availability',
      'test_attempts',
      'users',
      'student_profiles',
      'test_focus_events',
    ]) {
      const studentChunks = log.inCalls.filter((call) =>
        call.table === table &&
        (call.column === 'student_id' || call.column === 'id' || call.column === 'user_id')
      )
      expect(studentChunks.map((call) => call.values.length)).toContain(50)
      expect(studentChunks.map((call) => call.values.length)).toContain(1)
      expect(studentChunks.every((call) => call.values.length <= 50)).toBe(true)
    }

    expect(log.rangeCalls).toContainEqual({ table: 'test_responses', from: 0, to: 999 })
    expect(log.rangeCalls).toContainEqual({ table: 'test_responses', from: 1000, to: 1999 })
    expect(log.orderCalls).toContainEqual({ table: 'test_responses', column: 'id' })
    expect(log.orderCalls).toContainEqual({ table: 'test_attempts', column: 'id' })
    expect(log.orderCalls).toContainEqual({ table: 'test_focus_events', column: 'id' })
  })

  it('falls back when only test_attempts closure columns are missing', async () => {
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
      if (table === 'test_responses') return mockTestResponsesQuery([])
      if (table === 'test_attempts') {
        return mockChunkedTable(
          [
            {
              test_id: 'test-1',
              student_id: 'student-1',
              is_submitted: true,
              submitted_at: '2026-01-01T00:00:00.000Z',
              returned_at: '2026-01-02T00:00:00.000Z',
              returned_by: 'teacher-1',
              updated_at: '2026-01-02T00:00:00.000Z',
              responses: null,
            },
          ],
          {
            errorForSelect: (columns) =>
              columns.includes('closed_for_grading_at')
                ? {
                    code: 'PGRST204',
                    message: "Could not find column 'closed_for_grading_at'",
                  }
                : null,
          },
        )
      }
      if (table === 'users') return mockUsersQuery([{ id: 'student-1', email: 'student1@example.com' }])
      if (table === 'student_profiles') {
        return mockProfilesQuery([{ id: 'profile-1', user_id: 'student-1', first_name: 'Student', last_name: 'One' }])
      }
      if (table === 'test_focus_events') return mockFocusEventsQuery()
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/results'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.students[0].status).toBe('returned')
    expect(data.students[0].returned_at).toBe('2026-01-02T00:00:00.000Z')
    expect(data.students[0].closed_for_grading_at).toBeNull()
    expect(data.stats.returned_count).toBe(1)
  })

  it('falls back to the base legacy attempt shape when closure fallback also lacks return columns', async () => {
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
      if (table === 'test_responses') return mockTestResponsesQuery([])
      if (table === 'test_attempts') {
        return mockChunkedTable(
          [
            {
              test_id: 'test-1',
              student_id: 'student-1',
              is_submitted: true,
              submitted_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
              responses: null,
            },
          ],
          {
            errorForSelect: (columns) => {
              if (columns.includes('closed_for_grading_at')) {
                return {
                  code: 'PGRST204',
                  message: "Could not find column 'closed_for_grading_at'",
                }
              }
              if (columns.includes('returned_at')) {
                return {
                  code: 'PGRST204',
                  message: "Could not find column 'returned_at'",
                }
              }
              return null
            },
          },
        )
      }
      if (table === 'users') return mockUsersQuery([{ id: 'student-1', email: 'student1@example.com' }])
      if (table === 'student_profiles') {
        return mockProfilesQuery([{ id: 'profile-1', user_id: 'student-1', first_name: 'Student', last_name: 'One' }])
      }
      if (table === 'test_focus_events') return mockFocusEventsQuery()
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/results'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.students[0].status).toBe('submitted')
    expect(data.students[0].returned_at).toBeNull()
    expect(data.students[0].closed_for_grading_at).toBeNull()
  })

  it('continues when test student availability has not been migrated yet', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [{ id: 'question-1', question_type: 'multiple_choice', question_text: 'Q', options: ['A'], points: 1, position: 0 }],
              error: null,
            }),
          })),
        }
      }
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [{ student_id: 'student-1' }], error: null }),
          })),
        }
      }
      if (table === 'test_responses') return mockTestResponsesQuery([])
      if (table === 'test_student_availability') {
        return mockChunkedTable([], { errorForSelect: () => ({ code: 'PGRST205', message: 'missing table' }) })
      }
      if (table === 'test_attempts') return mockChunkedTable([])
      if (table === 'users') return mockUsersQuery([{ id: 'student-1', email: 'student1@example.com' }])
      if (table === 'student_profiles') {
        return mockProfilesQuery([{ id: 'profile-1', user_id: 'student-1', first_name: 'Student', last_name: 'One' }])
      }
      if (table === 'test_focus_events') return mockFocusEventsQuery()
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/results'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.students[0].access_state).toBeNull()
    expect(data.students[0].effective_access).toBe('open')
  })

  it('returns 500 when availability loading fails for a non-migration reason', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [{ id: 'question-1', question_type: 'multiple_choice', question_text: 'Q', options: ['A'], points: 1, position: 0 }],
              error: null,
            }),
          })),
        }
      }
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [{ student_id: 'student-1' }], error: null }),
          })),
        }
      }
      if (table === 'test_responses') return mockTestResponsesQuery([])
      if (table === 'test_student_availability') {
        return mockChunkedTable([], { errorForSelect: () => ({ code: '500', message: 'availability failed' }) })
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/results'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to fetch student access' })
  })

  it('returns 500 when user hydration fails', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [{ id: 'question-1', question_type: 'multiple_choice', question_text: 'Q', options: ['A'], points: 1, position: 0 }],
              error: null,
            }),
          })),
        }
      }
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [{ student_id: 'student-1' }], error: null }),
          })),
        }
      }
      if (table === 'test_responses') return mockTestResponsesQuery([])
      if (table === 'test_attempts') return mockChunkedTable([])
      if (table === 'users') return mockChunkedTable([], { errorForSelect: () => ({ message: 'users failed' }) })
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/results'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to fetch users' })
  })

  it('returns 500 when profile hydration fails', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [{ id: 'question-1', question_type: 'multiple_choice', question_text: 'Q', options: ['A'], points: 1, position: 0 }],
              error: null,
            }),
          })),
        }
      }
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [{ student_id: 'student-1' }], error: null }),
          })),
        }
      }
      if (table === 'test_responses') return mockTestResponsesQuery([])
      if (table === 'test_attempts') return mockChunkedTable([])
      if (table === 'users') return mockUsersQuery([{ id: 'student-1', email: 'student1@example.com' }])
      if (table === 'student_profiles') {
        return mockChunkedTable([], { errorForSelect: () => ({ message: 'profiles failed' }) })
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/results'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to fetch student profiles' })
  })

  it('returns 500 when focus event loading fails', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [{ id: 'question-1', question_type: 'multiple_choice', question_text: 'Q', options: ['A'], points: 1, position: 0 }],
              error: null,
            }),
          })),
        }
      }
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [{ student_id: 'student-1' }], error: null }),
          })),
        }
      }
      if (table === 'test_responses') return mockTestResponsesQuery([])
      if (table === 'test_attempts') return mockChunkedTable([])
      if (table === 'users') return mockUsersQuery([{ id: 'student-1', email: 'student1@example.com' }])
      if (table === 'student_profiles') {
        return mockProfilesQuery([{ id: 'profile-1', user_id: 'student-1', first_name: 'Student', last_name: 'One' }])
      }
      if (table === 'test_focus_events') {
        return mockChunkedTable([], { errorForSelect: () => ({ message: 'focus failed' }) })
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/results'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to fetch focus events' })
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
        return mockTestResponsesQuery([])
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
        return mockChunkedTable([
          {
            test_id: 'test-1',
            student_id: 'student-1',
            is_submitted: false,
            submitted_at: null,
            returned_at: null,
            returned_by: null,
            closed_for_grading_at: null,
            closed_for_grading_by: null,
            updated_at: '2026-01-02T12:00:00.000Z',
            responses: {
              'question-open-1': {
                question_type: 'open_response',
                response_text: 'Draft answer in progress',
              },
            },
          },
        ])
      }

      if (table === 'users') {
        return mockUsersQuery([{ id: 'student-1', email: 'student1@example.com' }])
      }

      if (table === 'student_profiles') {
        return mockProfilesQuery([{ id: 'profile-1', user_id: 'student-1', first_name: 'Student', last_name: 'One' }])
      }

      if (table === 'test_focus_events') {
        return mockFocusEventsQuery()
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
        return mockTestResponsesQuery([])
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
        return mockChunkedTable([])
      }

      if (table === 'users') {
        return mockUsersQuery([{ id: 'student-1', email: 'student1@example.com' }])
      }

      if (table === 'student_profiles') {
        return mockProfilesQuery([{ id: 'profile-1', user_id: 'student-1', first_name: 'Student', last_name: 'One' }])
      }

      if (table === 'test_focus_events') {
        return mockFocusEventsQuery()
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

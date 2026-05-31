import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/student/quizzes/[id]/results/route'
import { mockAuthenticationError } from '../setup'

const mockSupabaseClient = { from: vi.fn() }

type QueryLog = {
  inCalls: Array<{ table: string; column: string; values: string[] }>
  rangeCalls: Array<{ table: string; from: number; to: number }>
}

function createQueryLog(): QueryLog {
  return { inCalls: [], rangeCalls: [] }
}

function mockPagedTable(
  rows: Array<Record<string, any>>,
  options: {
    table?: string
    log?: QueryLog
    error?: any
  } = {},
) {
  return {
    select: vi.fn(() => {
      const filters: Array<{ column: string; values: string[] }> = []
      const filteredRows = () => rows.filter((row) =>
        filters.every((filter) => {
          if (!(filter.column in row)) return false
          return filter.values.includes(String(row[filter.column]))
        })
      )
      const resolveRows = (from: number, to: number) => {
        if (options.error) return Promise.resolve({ data: null, error: options.error })
        return Promise.resolve({ data: filteredRows().slice(from, to + 1), error: null })
      }
      const query: any = {
        eq: vi.fn((column: string, value: string) => {
          filters.push({ column, values: [String(value)] })
          return query
        }),
        in: vi.fn((column: string, values: string[]) => {
          filters.push({ column, values: values.map(String) })
          if (options.table) {
            options.log?.inCalls.push({ table: options.table, column, values: values.map(String) })
          }
          return query
        }),
        order: vi.fn(() => query),
        range: vi.fn((from: number, to: number) => {
          if (options.table) options.log?.rangeCalls.push({ table: options.table, from, to })
          return resolveRows(from, to)
        }),
        limit: vi.fn((count: number) => resolveRows(0, count - 1)),
        then: vi.fn((resolve: any, reject: any) => resolveRows(0, rows.length - 1).then(resolve, reject)),
      }
      return query
    }),
  }
}

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

  it('returns 500 when response visibility check fails', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'quiz_responses') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }),
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
    await expect(response.json()).resolves.toEqual({ error: 'Failed to fetch responses' })
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
        return mockPagedTable([], { error: { message: 'boom' } })
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

  it('returns 500 when classroom enrollment loading fails before aggregation', async () => {
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
        return mockPagedTable([
          {
            id: 'question-1',
            quiz_id: 'quiz-1',
            question_text: '2 + 2 = ?',
            options: ['4', '5'],
            correct_option: 0,
            position: 0,
          },
        ])
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }),
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
    await expect(response.json()).resolves.toEqual({ error: 'Failed to fetch responses' })
  })

  it('returns 500 when scoped response loading fails', async () => {
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
              return mockPagedTable([], { error: { message: 'boom' } }).select(columns)
            }

            throw new Error(`Unexpected quiz_responses columns: ${columns}`)
          }),
        }
      }

      if (table === 'quiz_questions') {
        return mockPagedTable([
          {
            id: 'question-1',
            quiz_id: 'quiz-1',
            question_text: '2 + 2 = ?',
            options: ['4', '5'],
            correct_option: 0,
            position: 0,
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

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/quizzes/quiz-1/results'),
      { params: Promise.resolve({ id: 'quiz-1' }) }
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to fetch responses' })
  })

  it('skips aggregate response loading when the classroom enrollment list is empty', async () => {
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
              throw new Error('Aggregate responses should not be loaded without enrolled students')
            }

            return {
              eq: vi.fn().mockReturnThis(),
              then: vi.fn((resolve: (value: unknown) => unknown) =>
                resolve({
                  data: [{ question_id: 'question-1', selected_option: 0 }],
                  error: null,
                })
              ),
            }
          }),
        }
      }

      if (table === 'quiz_questions') {
        return mockPagedTable([
          {
            id: 'question-1',
            quiz_id: 'quiz-1',
            question_text: '2 + 2 = ?',
            options: ['4', '5'],
            correct_option: 0,
            position: 0,
          },
        ])
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
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
    expect(data.results).toEqual([
      {
        question_id: 'question-1',
        question_text: '2 + 2 = ?',
        options: ['4', '5'],
        counts: [0, 0],
        total_responses: 0,
      },
    ])
    expect(data.my_responses).toEqual({ 'question-1': 0 })
  })

  it('returns 500 when student response loading fails', async () => {
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
              throw new Error('Aggregate responses should not be loaded without enrolled students')
            }

            if (columns === 'id, question_id, selected_option') {
              return mockPagedTable([], { error: { message: 'boom' } }).select(columns)
            }

            throw new Error(`Unexpected quiz_responses columns: ${columns}`)
          }),
        }
      }

      if (table === 'quiz_questions') {
        return mockPagedTable([
          {
            id: 'question-1',
            quiz_id: 'quiz-1',
            question_text: '2 + 2 = ?',
            options: ['4', '5'],
            correct_option: 0,
            position: 0,
          },
        ])
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
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
    await expect(response.json()).resolves.toEqual({ error: 'Failed to fetch responses' })
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
                eq: vi.fn().mockReturnThis(),
                in: vi.fn((column: string, studentIds: string[]) => {
                  expect(column).toBe('student_id')
                  expect(studentIds).toEqual(['student-1', 'student-2'])
                  return Promise.resolve({
                    data: [
                      { question_id: 'question-1', selected_option: 0, student_id: 'student-1' },
                      { question_id: 'question-1', selected_option: 1, student_id: 'student-2' },
                      { question_id: 'question-1', selected_option: 1, student_id: 'student-removed' },
                    ],
                    error: null,
                  })
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
        return mockPagedTable([
          {
            id: 'question-1',
            quiz_id: 'quiz-1',
            question_text: '2 + 2 = ?',
            options: ['4', '5'],
            correct_option: 0,
            position: 0,
          },
        ])
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [
                { student_id: 'student-1' },
                { student_id: 'student-2' },
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

  it('chunks enrolled student response filters and pages dense result rows', async () => {
    const studentIds = Array.from({ length: 51 }, (_, index) => `student-${index}`)
    const enrollments = studentIds.map((student_id) => ({ classroom_id: 'classroom-1', student_id }))
    const responses = [
      ...Array.from({ length: 1001 }, (_, index) => ({
        id: `response-page-${index}`,
        quiz_id: 'quiz-1',
        question_id: 'question-1',
        student_id: 'student-0',
        selected_option: 0,
      })),
      {
        id: 'response-last-chunk',
        quiz_id: 'quiz-1',
        question_id: 'question-1',
        student_id: 'student-50',
        selected_option: 1,
      },
      {
        id: 'response-stale',
        quiz_id: 'quiz-1',
        question_id: 'question-1',
        student_id: 'student-removed',
        selected_option: 1,
      },
    ]
    const log = createQueryLog()

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'quiz_responses') {
        return {
          select: vi.fn((columns: string) => {
            if (columns === 'id') {
              return {
                eq: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue({ data: [{ id: 'own-response' }], error: null }),
              }
            }
            if (columns === '*') return mockPagedTable(responses, { table, log }).select(columns)
            return {
              eq: vi.fn().mockReturnThis(),
              then: vi.fn((resolve: (value: unknown) => unknown) =>
                resolve({
                  data: [{ question_id: 'question-1', selected_option: 0 }],
                  error: null,
                })
              ),
            }
          }),
        }
      }

      if (table === 'quiz_questions') {
        return mockPagedTable([
          {
            id: 'question-1',
            quiz_id: 'quiz-1',
            question_text: '2 + 2 = ?',
            options: ['4', '5'],
            correct_option: 0,
            position: 0,
          },
        ])
      }

      if (table === 'classroom_enrollments') {
        return mockPagedTable(enrollments, { table, log })
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/quizzes/quiz-1/results'),
      { params: Promise.resolve({ id: 'quiz-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.results[0]).toEqual(
      expect.objectContaining({
        counts: [1001, 1],
        total_responses: 1002,
      })
    )
    expect(log.inCalls.filter((call) => call.table === 'quiz_responses').map((call) => call.values.length))
      .toEqual([50, 50, 1])
    expect(log.rangeCalls.filter((call) => call.table === 'quiz_responses')).toEqual([
      { table: 'quiz_responses', from: 0, to: 999 },
      { table: 'quiz_responses', from: 1000, to: 1999 },
      { table: 'quiz_responses', from: 0, to: 999 },
    ])
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/teacher/quizzes/route'
import { mockAuthenticationError } from '../setup'

const mockSupabaseClient = { from: vi.fn() }
const mockGetClassroomStudentIds = vi.hoisted(() => vi.fn())

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

vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherOwnsClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'classroom-1', teacher_id: 'teacher-1' },
  })),
  assertTeacherCanMutateClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'classroom-1', teacher_id: 'teacher-1', archived_at: null },
  })),
  getClassroomStudentIds: mockGetClassroomStudentIds,
}))

function buildQuizIdStatsTable(options: {
  rows: Array<Record<string, any>>
  error?: unknown
  filterColumn?: string
  inCalls?: Array<{ table: string; column: string; values: string[] }>
  orderCalls?: Array<{ table: string; column: string; ascending?: boolean }>
  pageable?: boolean
  rangeCalls?: Array<{ table: string; from: number; to: number }>
  table: string
}) {
  return {
    select: vi.fn(() => ({
      in: vi.fn((column: string, values: string[]) => {
        options.inCalls?.push({ table: options.table, column, values })
        if (options.error) {
          return Promise.resolve({ data: null, error: options.error })
        }
        const filterColumn = options.filterColumn ?? column
        const rows = options.rows.filter((row) => values.includes(row[filterColumn]))
        if (options.pageable) {
          const query: any = {
            order: vi.fn((orderColumn: string, orderOptions?: { ascending?: boolean }) => {
              options.orderCalls?.push({
                table: options.table,
                column: orderColumn,
                ascending: orderOptions?.ascending,
              })
              return query
            }),
            range: vi.fn((from: number, to: number) => {
              options.rangeCalls?.push({ table: options.table, from, to })
              return Promise.resolve({
                data: rows.slice(from, to + 1),
                error: null,
              })
            }),
          }
          return query
        }
        return Promise.resolve({ data: rows, error: null })
      }),
    })),
  }
}

function buildStudentScopedQuizStatsTable(options: {
  rows: Array<Record<string, any>>
  error?: unknown
  inCalls?: Array<{ table: string; column: string; values: string[] }>
  orderCalls?: Array<{ table: string; column: string; ascending?: boolean }>
  pageable?: boolean
  rangeCalls?: Array<{ table: string; from: number; to: number }>
  table: string
}) {
  return {
    select: vi.fn(() => {
      let selectedQuizIds: string[] = []
      const query: any = {
        in: vi.fn((column: string, values: string[]) => {
          options.inCalls?.push({ table: options.table, column, values })
          if (column === 'quiz_id') {
            selectedQuizIds = values
            return query
          }
          if (column === 'student_id') {
            if (options.error) {
              return Promise.resolve({ data: null, error: options.error })
            }
            const rows = options.rows.filter(
              (row) => selectedQuizIds.includes(row.quiz_id) && values.includes(row.student_id)
            )
            if (options.pageable) {
              const pageQuery: any = {
                order: vi.fn((orderColumn: string, orderOptions?: { ascending?: boolean }) => {
                  options.orderCalls?.push({
                    table: options.table,
                    column: orderColumn,
                    ascending: orderOptions?.ascending,
                  })
                  return pageQuery
                }),
                range: vi.fn((from: number, to: number) => {
                  options.rangeCalls?.push({ table: options.table, from, to })
                  return Promise.resolve({
                    data: rows.slice(from, to + 1),
                    error: null,
                  })
                }),
              }
              return pageQuery
            }
            return Promise.resolve({ data: rows, error: null })
          }
          return query
        }),
      }
      return query
    }),
  }
}

function buildAssessmentDraftRows(
  rows: Array<{ assessment_id: string; content: Record<string, unknown> }>,
  inCalls?: Array<{ table: string; column: string; values: string[] }>
) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        in: vi.fn((column: string, values: string[]) => {
          inCalls?.push({ table: 'assessment_drafts', column, values })
          return Promise.resolve({
            data: rows.filter((row) => values.includes(row.assessment_id)),
            error: null,
          })
        }),
      })),
    })),
  }
}

describe('teacher quizzes collection route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetClassroomStudentIds.mockResolvedValue({
      studentIds: ['student-1', 'student-2'],
      studentIdSet: new Set(['student-1', 'student-2']),
      totalStudents: 2,
      error: null,
    })
  })

  it('returns 401 when unauthenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    ;(requireRole as any).mockRejectedValueOnce(mockAuthenticationError())

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/quizzes?classroom_id=classroom-1')
    )

    expect(response.status).toBe(401)
  })

  it('lists quizzes with draft overlays and stats', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'quizzes') {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          then: vi.fn((resolve: any) =>
            resolve({
              data: [
                {
                  id: 'quiz-1',
                  classroom_id: 'classroom-1',
                  title: 'Stored title',
                  status: 'draft',
                  show_results: false,
                  position: 0,
                  created_at: '2026-03-01T00:00:00.000Z',
                },
              ],
              error: null,
            })
          ),
        }
        return chain
      }
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [
                { student_id: 'student-1' },
                { student_id: 'student-2' },
              ],
              count: 2,
              error: null,
            }),
          })),
        }
      }
      if (table === 'quiz_questions') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [{ quiz_id: 'quiz-1' }], error: null }),
          })),
        }
      }
      if (table === 'quiz_responses') {
        const responseFilter: any = {
          in: vi.fn((column: string, values: string[]) => {
            if (column === 'quiz_id') {
              expect(values).toEqual(['quiz-1'])
              return responseFilter
            }
            if (column === 'student_id') {
              expect(values).toEqual(['student-1', 'student-2'])
              return Promise.resolve({
                data: [
                  { quiz_id: 'quiz-1', student_id: 'student-1' },
                  { quiz_id: 'quiz-1', student_id: 'student-stale' },
                ],
                error: null,
              })
            }
            throw new Error(`Unexpected quiz_responses in column: ${column}`)
          }),
        }
        return {
          select: vi.fn(() => ({
            in: responseFilter.in,
          })),
        }
      }
      if (table === 'assessment_drafts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  assessment_id: 'quiz-1',
                  content: {
                    title: 'Draft title',
                    show_results: true,
                    questions: [
                      {
                        id: '11111111-1111-4111-8111-111111111111',
                        question_text: 'Draft question',
                        options: ['A', 'B'],
                      },
                    ],
                  },
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
      new NextRequest('http://localhost:3000/api/teacher/quizzes?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.quizzes[0].title).toBe('Draft title')
    expect(data.quizzes[0].stats).toEqual({
      total_students: 2,
      responded: 1,
      questions_count: 1,
    })
  })

  it('returns 500 when enrollment loading fails', async () => {
    mockGetClassroomStudentIds.mockResolvedValueOnce({
      studentIds: [],
      studentIdSet: new Set(),
      totalStudents: 0,
      error: { message: 'boom' },
    })
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'quizzes') {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          then: vi.fn((resolve: any) => resolve({ data: [], error: null })),
        }
        return chain
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/quizzes?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to fetch classroom enrollments' })
  })

  it('skips response stat loading when no students are enrolled', async () => {
    mockGetClassroomStudentIds.mockResolvedValueOnce({
      studentIds: [],
      studentIdSet: new Set(),
      totalStudents: 0,
      error: null,
    })
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'quizzes') {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          then: vi.fn((resolve: any) =>
            resolve({
              data: [
                {
                  id: 'quiz-1',
                  classroom_id: 'classroom-1',
                  title: 'Quiz One',
                  status: 'draft',
                  show_results: false,
                  position: 0,
                  created_at: '2026-03-01T00:00:00.000Z',
                },
              ],
              error: null,
            })
          ),
        }
        return chain
      }
      if (table === 'quiz_questions') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [{ quiz_id: 'quiz-1' }], error: null }),
          })),
        }
      }
      if (table === 'assessment_drafts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/quizzes?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.quizzes[0].stats).toEqual({
      total_students: 0,
      responded: 0,
      questions_count: 1,
    })
    expect(mockSupabaseClient.from).not.toHaveBeenCalledWith('quiz_responses')
  })

  it('returns 500 when scoped quiz response stat loading fails', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'quizzes') {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          then: vi.fn((resolve: any) =>
            resolve({
              data: [
                {
                  id: 'quiz-1',
                  classroom_id: 'classroom-1',
                  title: 'Quiz One',
                  status: 'draft',
                  show_results: false,
                  position: 0,
                  created_at: '2026-03-01T00:00:00.000Z',
                },
              ],
              error: null,
            })
          ),
        }
        return chain
      }
      if (table === 'quiz_questions') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [{ quiz_id: 'quiz-1' }], error: null }),
          })),
        }
      }
      if (table === 'quiz_responses') {
        const responseFilter: any = {
          in: vi.fn((column: string) => {
            if (column === 'quiz_id') return responseFilter
            if (column === 'student_id') return Promise.resolve({ data: null, error: { message: 'boom' } })
            throw new Error(`Unexpected quiz_responses in column: ${column}`)
          }),
        }
        return {
          select: vi.fn(() => ({
            in: responseFilter.in,
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/quizzes?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to fetch quiz response stats' })
  })

  it('returns 500 when quiz question stat loading fails', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'quizzes') {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          then: vi.fn((resolve: any) =>
            resolve({
              data: [
                {
                  id: 'quiz-1',
                  classroom_id: 'classroom-1',
                  title: 'Quiz One',
                  status: 'draft',
                  show_results: false,
                  position: 0,
                  created_at: '2026-03-01T00:00:00.000Z',
                },
              ],
              error: null,
            })
          ),
        }
        return chain
      }
      if (table === 'quiz_questions') {
        return buildQuizIdStatsTable({
          table,
          rows: [],
          error: { message: 'question stats failed' },
        })
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/quizzes?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to fetch quiz question stats' })
  })

  it('chunks quiz stats filters for large rosters and quiz lists', async () => {
    const studentIds = Array.from({ length: 51 }, (_, index) => `student-${index + 1}`)
    const quizRows = Array.from({ length: 51 }, (_, index) => ({
      id: `quiz-${index + 1}`,
      classroom_id: 'classroom-1',
      title: `Quiz ${index + 1}`,
      status: 'draft',
      show_results: false,
      position: index,
      created_at: '2026-03-01T00:00:00.000Z',
    }))
    const questionRows = quizRows.map((quiz) => ({ quiz_id: quiz.id }))
    const statsInCalls: Array<{ table: string; column: string; values: string[] }> = []

    mockGetClassroomStudentIds.mockResolvedValueOnce({
      studentIds,
      studentIdSet: new Set(studentIds),
      totalStudents: studentIds.length,
      error: null,
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'quizzes') {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          then: vi.fn((resolve: any) =>
            resolve({
              data: quizRows,
              error: null,
            })
          ),
        }
        return chain
      }

      if (table === 'quiz_questions') {
        return buildQuizIdStatsTable({
          table,
          rows: questionRows,
          filterColumn: 'quiz_id',
          inCalls: statsInCalls,
        })
      }

      if (table === 'quiz_responses') {
        return buildStudentScopedQuizStatsTable({
          table,
          inCalls: statsInCalls,
          rows: [
            { quiz_id: 'quiz-1', student_id: 'student-1' },
            { quiz_id: 'quiz-1', student_id: 'student-2' },
          ],
        })
      }

      if (table === 'assessment_drafts') {
        return buildAssessmentDraftRows(
          [
            {
              assessment_id: 'quiz-51',
              content: {
                title: 'Draft Quiz 51',
                show_results: true,
                questions: [],
              },
            },
          ],
          statsInCalls
        )
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/quizzes?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.quizzes).toHaveLength(51)
    expect(data.quizzes[0].stats).toEqual({
      total_students: 51,
      responded: 2,
      questions_count: 1,
    })
    expect(data.quizzes[50].title).toBe('Draft Quiz 51')
    expect(statsInCalls.every((call) => call.values.length <= 50)).toBe(true)
    expect(statsInCalls).toContainEqual({
      table: 'quiz_questions',
      column: 'quiz_id',
      values: quizRows.slice(0, 50).map((quiz) => quiz.id),
    })
    expect(statsInCalls).toContainEqual({
      table: 'quiz_questions',
      column: 'quiz_id',
      values: ['quiz-51'],
    })
    expect(statsInCalls).toContainEqual({
      table: 'quiz_responses',
      column: 'student_id',
      values: studentIds.slice(0, 50),
    })
    expect(statsInCalls).toContainEqual({
      table: 'quiz_responses',
      column: 'student_id',
      values: ['student-51'],
    })
    expect(statsInCalls).toContainEqual({
      table: 'assessment_drafts',
      column: 'assessment_id',
      values: ['quiz-51'],
    })
  })

  it('paginates quiz stat rows inside each filter chunk', async () => {
    const questionRows = Array.from({ length: 1001 }, () => ({ quiz_id: 'quiz-1' }))
    const responseRows = [
      ...Array.from({ length: 1000 }, () => ({ quiz_id: 'quiz-1', student_id: 'student-1' })),
      { quiz_id: 'quiz-1', student_id: 'student-2' },
    ]
    const orderCalls: Array<{ table: string; column: string; ascending?: boolean }> = []
    const rangeCalls: Array<{ table: string; from: number; to: number }> = []

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'quizzes') {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          then: vi.fn((resolve: any) =>
            resolve({
              data: [
                {
                  id: 'quiz-1',
                  classroom_id: 'classroom-1',
                  title: 'Quiz One',
                  status: 'draft',
                  show_results: false,
                  position: 0,
                  created_at: '2026-03-01T00:00:00.000Z',
                },
              ],
              error: null,
            })
          ),
        }
        return chain
      }

      if (table === 'quiz_questions') {
        return buildQuizIdStatsTable({
          table,
          rows: questionRows,
          filterColumn: 'quiz_id',
          orderCalls,
          pageable: true,
          rangeCalls,
        })
      }

      if (table === 'quiz_responses') {
        return buildStudentScopedQuizStatsTable({
          table,
          rows: responseRows,
          orderCalls,
          pageable: true,
          rangeCalls,
        })
      }

      if (table === 'assessment_drafts') {
        return buildAssessmentDraftRows([])
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/quizzes?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.quizzes[0].stats).toEqual({
      total_students: 2,
      responded: 2,
      questions_count: 1001,
    })
    expect(orderCalls).toEqual([
      { table: 'quiz_questions', column: 'id', ascending: true },
      { table: 'quiz_questions', column: 'id', ascending: true },
      { table: 'quiz_responses', column: 'id', ascending: true },
      { table: 'quiz_responses', column: 'id', ascending: true },
    ])
    expect(rangeCalls).toContainEqual({ table: 'quiz_questions', from: 0, to: 999 })
    expect(rangeCalls).toContainEqual({ table: 'quiz_questions', from: 1000, to: 1999 })
    expect(rangeCalls).toContainEqual({ table: 'quiz_responses', from: 0, to: 999 })
    expect(rangeCalls).toContainEqual({ table: 'quiz_responses', from: 1000, to: 1999 })
  })

  it('keeps quiz draft overlays visible for active list rows', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'quizzes') {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          then: vi.fn((resolve: any) =>
            resolve({
              data: [
                {
                  id: 'quiz-1',
                  classroom_id: 'classroom-1',
                  title: 'Canonical active title',
                  status: 'active',
                  show_results: false,
                  position: 0,
                  created_at: '2026-03-01T00:00:00.000Z',
                },
              ],
              error: null,
            })
          ),
        }
        return chain
      }

      if (table === 'quiz_questions') {
        return buildQuizIdStatsTable({
          table,
          rows: [{ quiz_id: 'quiz-1' }],
          filterColumn: 'quiz_id',
        })
      }

      if (table === 'quiz_responses') {
        return buildStudentScopedQuizStatsTable({ table, rows: [] })
      }

      if (table === 'assessment_drafts') {
        return buildAssessmentDraftRows([
          {
            assessment_id: 'quiz-1',
            content: {
              title: 'Draft active title',
              show_results: true,
              questions: [
                {
                  id: '11111111-1111-4111-8111-111111111111',
                  question_text: 'Draft question',
                  options: ['A', 'B'],
                },
                {
                  id: '22222222-2222-4222-8222-222222222222',
                  question_text: 'Second draft question',
                  options: ['C', 'D'],
                },
              ],
            },
          },
        ])
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/quizzes?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.quizzes[0].title).toBe('Draft active title')
    expect(data.quizzes[0].show_results).toBe(true)
    expect(data.quizzes[0].stats.questions_count).toBe(2)
  })

  it('creates a new quiz at the next position', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'quizzes') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { position: 2 },
                    error: null,
                  }),
                })),
              })),
            })),
          })),
          insert: vi.fn((payload: Record<string, unknown>) => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'quiz-1', ...payload },
                error: null,
              }),
            })),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/quizzes', {
        method: 'POST',
        body: JSON.stringify({ classroom_id: 'classroom-1', title: ' New Quiz ' }),
      })
    )
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.quiz.position).toBe(3)
    expect(data.quiz.title).toBe('New Quiz')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/teacher/surveys/[id]/results/route'

const mockSupabaseClient = { from: vi.fn() }

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

vi.mock('@/lib/server/surveys', () => ({
  assertTeacherOwnsSurvey: vi.fn(async () => ({
    ok: true,
    survey: {
      id: 'survey-1',
      classroom_id: 'classroom-1',
      title: 'Survey One',
      status: 'active',
      show_results: true,
      dynamic_responses: false,
      position: 0,
      created_by: 'teacher-1',
      created_at: '2026-05-01T00:00:00.000Z',
      updated_at: '2026-05-01T00:00:00.000Z',
      classrooms: { id: 'classroom-1', teacher_id: 'teacher-1', archived_at: null },
    },
  })),
}))

type QueryLog = {
  inCalls: Array<{ table: string; column: string; values: string[] }>
  orderCalls: Array<{ table: string; column: string }>
  rangeCalls: Array<{ table: string; from: number; to: number }>
}

function createQueryLog(): QueryLog {
  return { inCalls: [], orderCalls: [], rangeCalls: [] }
}

function createPagedTable(
  table: string,
  rows: Array<Record<string, any>>,
  log: QueryLog,
  error: any = null,
) {
  return {
    select: vi.fn(() => {
      const filters: Array<{ column: string; values: string[] }> = []
      const orderColumns: string[] = []
      const query: any = {
        in: vi.fn((column: string, values: string[]) => {
          log.inCalls.push({ table, column, values })
          filters.push({ column, values })
          return query
        }),
        order: vi.fn((column: string) => {
          log.orderCalls.push({ table, column })
          orderColumns.push(column)
          return query
        }),
        range: vi.fn((from: number, to: number) => {
          log.rangeCalls.push({ table, from, to })
          if (error) {
            return Promise.resolve({ data: null, count: null, error })
          }

          const filteredRows = rows.filter((row) =>
            filters.every((filter) => filter.values.includes(String(row[filter.column])))
          )
          const orderedRows = [...filteredRows].sort((a, b) => {
            for (const column of orderColumns) {
              const valueA = String(a[column] ?? '')
              const valueB = String(b[column] ?? '')
              const result = valueA.localeCompare(valueB)
              if (result !== 0) return result
            }
            return 0
          })

          return Promise.resolve({
            data: orderedRows.slice(from, to + 1),
            count: orderedRows.length,
            error: null,
          })
        }),
      }

      return query
    }),
  }
}

describe('GET /api/teacher/surveys/[id]/results', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 500 when enrollment loading fails', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'survey_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [{ id: 'q-mc', question_type: 'multiple_choice', question_text: 'Choose one', options: ['A'], position: 0 }],
              error: null,
            }),
          })),
        }
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: null, count: null, error: { message: 'boom' } }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/surveys/survey-1/results'),
      { params: Promise.resolve({ id: 'survey-1' }) },
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to fetch classroom enrollments' })
  })

  it('skips response and responder loading when no students are enrolled', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'survey_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [{ id: 'q-mc', question_type: 'multiple_choice', question_text: 'Choose one', options: ['A', 'B'], position: 0 }],
              error: null,
            }),
          })),
        }
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/surveys/survey-1/results'),
      { params: Promise.resolve({ id: 'survey-1' }) },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.results[0].counts).toEqual([0, 0])
    expect(data.responders).toEqual([])
    expect(data.stats).toEqual({ total_students: 0, responded: 0 })
  })

  it('aggregates and hydrates only current enrolled student responses', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'survey_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'q-mc',
                  survey_id: 'survey-1',
                  question_type: 'multiple_choice',
                  question_text: 'Choose one',
                  options: ['A', 'B'],
                  response_max_chars: 500,
                  position: 0,
                },
                {
                  id: 'q-text',
                  survey_id: 'survey-1',
                  question_type: 'short_text',
                  question_text: 'Explain',
                  options: [],
                  response_max_chars: 500,
                  position: 1,
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

      if (table === 'survey_responses') {
        return {
          select: vi.fn(() => ({
            in: vi.fn((column: string, values: string[]) => {
              expect(column).toBe('survey_id')
              expect(values).toEqual(['survey-1'])
              return {
                in: vi.fn((studentColumn: string, studentIds: string[]) => {
                  expect(studentColumn).toBe('student_id')
                  expect(studentIds).toEqual(['student-1', 'student-2'])
                  return {
                    order: vi.fn().mockReturnThis(),
                    range: vi.fn().mockResolvedValue({
                      data: [
                        {
                          id: 'response-1',
                          survey_id: 'survey-1',
                          question_id: 'q-mc',
                          student_id: 'student-1',
                          selected_option: 0,
                          response_text: null,
                          submitted_at: '2026-05-01T00:00:00.000Z',
                          updated_at: '2026-05-01T00:00:00.000Z',
                        },
                        {
                          id: 'response-2',
                          survey_id: 'survey-1',
                          question_id: 'q-mc',
                          student_id: 'student-2',
                          selected_option: 1,
                          response_text: null,
                          submitted_at: '2026-05-01T00:00:00.000Z',
                          updated_at: '2026-05-01T00:00:00.000Z',
                        },
                        {
                          id: 'response-stale-mc',
                          survey_id: 'survey-1',
                          question_id: 'q-mc',
                          student_id: 'student-stale',
                          selected_option: 1,
                          response_text: null,
                          submitted_at: '2026-05-02T00:00:00.000Z',
                          updated_at: '2026-05-02T00:00:00.000Z',
                        },
                        {
                          id: 'response-3',
                          survey_id: 'survey-1',
                          question_id: 'q-text',
                          student_id: 'student-1',
                          selected_option: null,
                          response_text: 'Enrolled answer',
                          submitted_at: '2026-05-03T00:00:00.000Z',
                          updated_at: '2026-05-03T00:00:00.000Z',
                        },
                        {
                          id: 'response-stale-text',
                          survey_id: 'survey-1',
                          question_id: 'q-text',
                          student_id: 'student-stale',
                          selected_option: null,
                          response_text: 'Stale answer',
                          submitted_at: '2026-05-04T00:00:00.000Z',
                          updated_at: '2026-05-04T00:00:00.000Z',
                        },
                      ],
                      error: null,
                    }),
                  }
                }),
              }
            }),
          })),
        }
      }

      if (table === 'users') {
        return {
          select: vi.fn(() => ({
            in: vi.fn((column: string, studentIds: string[]) => {
              expect(column).toBe('id')
              expect(studentIds).toEqual(['student-1', 'student-2'])
              return {
                order: vi.fn().mockReturnThis(),
                range: vi.fn().mockResolvedValue({
                  data: [
                    { id: 'student-1', email: 'alice@example.com' },
                    { id: 'student-2', email: 'zed@example.com' },
                  ],
                  error: null,
                }),
              }
            }),
          })),
        }
      }

      if (table === 'student_profiles') {
        return {
          select: vi.fn(() => ({
            in: vi.fn((column: string, studentIds: string[]) => {
              expect(column).toBe('user_id')
              expect(studentIds).toEqual(['student-1', 'student-2'])
              return {
                order: vi.fn().mockReturnThis(),
                range: vi.fn().mockResolvedValue({
                  data: [
                    { user_id: 'student-1', first_name: 'Alice', last_name: 'Brown' },
                    { user_id: 'student-2', first_name: 'Zed', last_name: 'Young' },
                  ],
                  error: null,
                }),
              }
            }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/surveys/survey-1/results'),
      { params: Promise.resolve({ id: 'survey-1' }) },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.results[0].counts).toEqual([1, 1])
    expect(data.results[1].responses).toEqual([
      {
        response_id: 'response-3',
        student_id: 'student-1',
        name: 'Alice Brown',
        email: 'alice@example.com',
        response_text: 'Enrolled answer',
        submitted_at: '2026-05-03T00:00:00.000Z',
        updated_at: '2026-05-03T00:00:00.000Z',
      },
    ])
    expect(data.responders.map((responder: { student_id: string }) => responder.student_id)).toEqual([
      'student-1',
      'student-2',
    ])
    expect(data.stats).toEqual({ total_students: 2, responded: 2 })
  })

  it('chunks and paginates response and responder reads for large rosters', async () => {
    const log = createQueryLog()
    const studentIds = Array.from({ length: 51 }, (_, index) =>
      `student-${String(index + 1).padStart(3, '0')}`
    )
    const questions = Array.from({ length: 25 }, (_, index) => ({
      id: `q-${String(index + 1).padStart(2, '0')}`,
      survey_id: 'survey-1',
      question_type: 'multiple_choice',
      question_text: `Question ${index + 1}`,
      options: ['A', 'B'],
      response_max_chars: 500,
      position: index,
    }))
    const responseRows = studentIds.flatMap((studentId) =>
      questions.map((question) => ({
        id: `response-${studentId}-${question.id}`,
        survey_id: 'survey-1',
        question_id: question.id,
        student_id: studentId,
        selected_option: 0,
        response_text: null,
        submitted_at: '2026-05-01T00:00:00.000Z',
        updated_at: '2026-05-01T00:00:00.000Z',
      }))
    )
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

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'survey_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: questions, error: null }),
          })),
        }
      }
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: studentIds.map((studentId) => ({ student_id: studentId })),
              count: studentIds.length,
              error: null,
            }),
          })),
        }
      }
      if (table === 'survey_responses') return createPagedTable(table, responseRows, log)
      if (table === 'users') return createPagedTable(table, userRows, log)
      if (table === 'student_profiles') return createPagedTable(table, profileRows, log)
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/surveys/survey-1/results'),
      { params: Promise.resolve({ id: 'survey-1' }) },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.results).toHaveLength(25)
    expect(data.results[0].total_responses).toBe(51)
    expect(data.stats).toEqual({ total_students: 51, responded: 51 })

    const responseStudentChunks = log.inCalls.filter(
      (call) => call.table === 'survey_responses' && call.column === 'student_id'
    )
    expect(responseStudentChunks.map((call) => call.values.length)).toContain(50)
    expect(responseStudentChunks.map((call) => call.values.length)).toContain(1)
    expect(responseStudentChunks.every((call) => call.values.length <= 50)).toBe(true)
    expect(log.rangeCalls).toContainEqual({ table: 'survey_responses', from: 0, to: 999 })
    expect(log.rangeCalls).toContainEqual({ table: 'survey_responses', from: 1000, to: 1999 })

    const userChunks = log.inCalls.filter((call) => call.table === 'users' && call.column === 'id')
    const profileChunks = log.inCalls.filter(
      (call) => call.table === 'student_profiles' && call.column === 'user_id'
    )
    expect(userChunks.every((call) => call.values.length <= 50)).toBe(true)
    expect(profileChunks.every((call) => call.values.length <= 50)).toBe(true)
    expect(log.orderCalls).toContainEqual({ table: 'survey_responses', column: 'id' })
    expect(log.orderCalls).toContainEqual({ table: 'users', column: 'id' })
    expect(log.orderCalls).toContainEqual({ table: 'student_profiles', column: 'id' })
  })

  it('returns 500 when responder profile loading fails', async () => {
    const log = createQueryLog()

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'survey_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'q-mc',
                  survey_id: 'survey-1',
                  question_type: 'multiple_choice',
                  question_text: 'Choose one',
                  options: ['A', 'B'],
                  response_max_chars: 500,
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
              count: 1,
              error: null,
            }),
          })),
        }
      }

      if (table === 'survey_responses') {
        return createPagedTable(
          table,
          [
            {
              id: 'response-1',
              survey_id: 'survey-1',
              question_id: 'q-mc',
              student_id: 'student-1',
              selected_option: 0,
              response_text: null,
              submitted_at: '2026-05-01T00:00:00.000Z',
              updated_at: '2026-05-01T00:00:00.000Z',
            },
          ],
          log,
        )
      }
      if (table === 'users') {
        return createPagedTable(table, [{ id: 'student-1', email: 'student@example.com' }], log)
      }
      if (table === 'student_profiles') {
        return createPagedTable(table, [], log, { message: 'profiles failed' })
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/surveys/survey-1/results'),
      { params: Promise.resolve({ id: 'survey-1' }) },
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to fetch responder profiles' })
  })
})

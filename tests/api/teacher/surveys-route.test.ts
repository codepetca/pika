import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/teacher/surveys/route'

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
  assertTeacherCanMutateClassroom: vi.fn(async () => ({ ok: true })),
  assertTeacherOwnsClassroom: vi.fn(async () => ({ ok: true })),
  getClassroomStudentIds: mockGetClassroomStudentIds,
}))

function buildSurveyIdStatsTable(options: {
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

function buildStudentScopedSurveyStatsTable(options: {
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
      let selectedSurveyIds: string[] = []
      const query: any = {
        in: vi.fn((column: string, values: string[]) => {
          options.inCalls?.push({ table: options.table, column, values })
          if (column === 'survey_id') {
            selectedSurveyIds = values
            return query
          }
          if (column === 'student_id') {
            if (options.error) {
              return Promise.resolve({ data: null, error: options.error })
            }
            const rows = options.rows.filter(
              (row) => selectedSurveyIds.includes(row.survey_id) && values.includes(row.student_id)
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

describe('GET /api/teacher/surveys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetClassroomStudentIds.mockResolvedValue({
      studentIds: ['student-1', 'student-2'],
      studentIdSet: new Set(['student-1', 'student-2']),
      totalStudents: 2,
      error: null,
    })
  })

  it('returns migration-required when the surveys table is missing', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'surveys') {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          then: vi.fn((resolve: any) =>
            resolve({
              data: null,
              error: { code: 'PGRST205', message: 'Could not find the table public.surveys' },
            })
          ),
        }
        return chain
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/surveys?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ surveys: [], migration_required: true })
    expect(mockGetClassroomStudentIds).not.toHaveBeenCalled()
    expect(mockSupabaseClient.from).not.toHaveBeenCalledWith('survey_questions')
    expect(mockSupabaseClient.from).not.toHaveBeenCalledWith('survey_responses')
  })

  it('returns 500 when the surveys list query fails', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'surveys') {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          then: vi.fn((resolve: any) =>
            resolve({
              data: null,
              error: { code: 'DATABASE_DOWN', message: 'database offline' },
            })
          ),
        }
        return chain
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/surveys?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to fetch surveys' })
    expect(mockGetClassroomStudentIds).not.toHaveBeenCalled()
    expect(mockSupabaseClient.from).not.toHaveBeenCalledWith('survey_questions')
    expect(mockSupabaseClient.from).not.toHaveBeenCalledWith('survey_responses')
  })

  it('orders surveys by classwork position and creation time', async () => {
    const orderCalls: Array<{ column: string; ascending?: boolean }> = []
    const surveyRows = [
      {
        id: 'survey-1',
        classroom_id: 'classroom-1',
        title: 'Survey One',
        status: 'active',
        show_results: true,
        dynamic_responses: false,
        position: 0,
        created_at: '2026-05-01T00:00:00.000Z',
      },
      {
        id: 'survey-2',
        classroom_id: 'classroom-1',
        title: 'Survey Two',
        status: 'active',
        show_results: true,
        dynamic_responses: false,
        position: 1,
        created_at: '2026-05-02T00:00:00.000Z',
      },
    ]
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'surveys') {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn((column: string, options?: { ascending?: boolean }) => {
            orderCalls.push({ column, ascending: options?.ascending })
            return chain
          }),
          then: vi.fn((resolve: any) => resolve({ data: surveyRows, error: null })),
        }
        return chain
      }
      if (table === 'survey_questions') {
        return buildSurveyIdStatsTable({
          table,
          rows: [],
          filterColumn: 'survey_id',
        })
      }
      if (table === 'survey_responses') {
        return buildStudentScopedSurveyStatsTable({
          table,
          rows: [],
        })
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/surveys?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(orderCalls).toEqual([
      { column: 'position', ascending: true },
      { column: 'created_at', ascending: true },
    ])
    expect(data.surveys.map((survey: { id: string }) => survey.id)).toEqual(['survey-1', 'survey-2'])
  })

  it('counts only currently enrolled responders in survey stats', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'surveys') {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          then: vi.fn((resolve: any) =>
            resolve({
              data: [
                {
                  id: 'survey-1',
                  classroom_id: 'classroom-1',
                  title: 'Survey One',
                  status: 'active',
                  show_results: true,
                  dynamic_responses: false,
                  position: 0,
                  created_at: '2026-05-01T00:00:00.000Z',
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
      if (table === 'survey_questions') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [{ survey_id: 'survey-1' }], error: null }),
          })),
        }
      }
      if (table === 'survey_responses') {
        const responseFilter: any = {
          in: vi.fn((column: string, values: string[]) => {
            if (column === 'survey_id') {
              expect(values).toEqual(['survey-1'])
              return responseFilter
            }
            if (column === 'student_id') {
              expect(values).toEqual(['student-1', 'student-2'])
              return Promise.resolve({
                data: [
                  { survey_id: 'survey-1', student_id: 'student-1' },
                  { survey_id: 'survey-1', student_id: 'student-stale' },
                ],
                error: null,
              })
            }
            throw new Error(`Unexpected survey_responses in column: ${column}`)
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
      new NextRequest('http://localhost:3000/api/teacher/surveys?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.surveys[0].stats).toEqual({
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
      if (table === 'surveys') {
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
      new NextRequest('http://localhost:3000/api/teacher/surveys?classroom_id=classroom-1')
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
      if (table === 'surveys') {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          then: vi.fn((resolve: any) =>
            resolve({
              data: [
                {
                  id: 'survey-1',
                  classroom_id: 'classroom-1',
                  title: 'Survey One',
                  status: 'active',
                  show_results: true,
                  dynamic_responses: false,
                  position: 0,
                  created_at: '2026-05-01T00:00:00.000Z',
                },
              ],
              error: null,
            })
          ),
        }
        return chain
      }
      if (table === 'survey_questions') {
        return buildSurveyIdStatsTable({
          table,
          rows: [{ survey_id: 'survey-1' }],
          filterColumn: 'survey_id',
        })
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/surveys?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.surveys[0].stats).toEqual({
      total_students: 0,
      responded: 0,
      questions_count: 1,
    })
    expect(mockSupabaseClient.from).not.toHaveBeenCalledWith('survey_responses')
  })

  it('returns 500 when survey question stat loading fails', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'surveys') {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          then: vi.fn((resolve: any) =>
            resolve({
              data: [
                {
                  id: 'survey-1',
                  classroom_id: 'classroom-1',
                  title: 'Survey One',
                  status: 'active',
                  show_results: true,
                  dynamic_responses: false,
                  position: 0,
                  created_at: '2026-05-01T00:00:00.000Z',
                },
              ],
              error: null,
            })
          ),
        }
        return chain
      }
      if (table === 'survey_questions') {
        return buildSurveyIdStatsTable({
          table,
          rows: [],
          error: { message: 'question stats failed' },
        })
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/surveys?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to fetch survey question stats' })
  })

  it('returns 500 when scoped survey response stat loading fails', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'surveys') {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          then: vi.fn((resolve: any) =>
            resolve({
              data: [
                {
                  id: 'survey-1',
                  classroom_id: 'classroom-1',
                  title: 'Survey One',
                  status: 'active',
                  show_results: true,
                  dynamic_responses: false,
                  position: 0,
                  created_at: '2026-05-01T00:00:00.000Z',
                },
              ],
              error: null,
            })
          ),
        }
        return chain
      }
      if (table === 'survey_questions') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [{ survey_id: 'survey-1' }], error: null }),
          })),
        }
      }
      if (table === 'survey_responses') {
        const responseFilter: any = {
          in: vi.fn((column: string) => {
            if (column === 'survey_id') return responseFilter
            if (column === 'student_id') return Promise.resolve({ data: null, error: { message: 'boom' } })
            throw new Error(`Unexpected survey_responses in column: ${column}`)
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
      new NextRequest('http://localhost:3000/api/teacher/surveys?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to fetch survey response stats' })
  })

  it('chunks survey stats filters for large rosters and survey lists', async () => {
    const studentIds = Array.from({ length: 51 }, (_, index) => `student-${index + 1}`)
    const surveyRows = Array.from({ length: 51 }, (_, index) => ({
      id: `survey-${index + 1}`,
      classroom_id: 'classroom-1',
      title: `Survey ${index + 1}`,
      status: 'active',
      show_results: true,
      dynamic_responses: false,
      position: index,
      created_at: '2026-05-01T00:00:00.000Z',
    }))
    const questionRows = surveyRows.map((survey) => ({ survey_id: survey.id }))
    const statsInCalls: Array<{ table: string; column: string; values: string[] }> = []

    mockGetClassroomStudentIds.mockResolvedValueOnce({
      studentIds,
      studentIdSet: new Set(studentIds),
      totalStudents: studentIds.length,
      error: null,
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'surveys') {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          then: vi.fn((resolve: any) =>
            resolve({
              data: surveyRows,
              error: null,
            })
          ),
        }
        return chain
      }

      if (table === 'survey_questions') {
        return buildSurveyIdStatsTable({
          table,
          rows: questionRows,
          filterColumn: 'survey_id',
          inCalls: statsInCalls,
        })
      }

      if (table === 'survey_responses') {
        return buildStudentScopedSurveyStatsTable({
          table,
          inCalls: statsInCalls,
          rows: [
            { survey_id: 'survey-1', student_id: 'student-1' },
            { survey_id: 'survey-1', student_id: 'student-2' },
            { survey_id: 'survey-51', student_id: 'student-51' },
          ],
        })
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/surveys?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.surveys).toHaveLength(51)
    expect(data.surveys[0].stats).toEqual({
      total_students: 51,
      responded: 2,
      questions_count: 1,
    })
    expect(data.surveys[50].stats).toEqual({
      total_students: 51,
      responded: 1,
      questions_count: 1,
    })
    expect(statsInCalls.every((call) => call.values.length <= 50)).toBe(true)
    expect(statsInCalls).toContainEqual({
      table: 'survey_questions',
      column: 'survey_id',
      values: surveyRows.slice(0, 50).map((survey) => survey.id),
    })
    expect(statsInCalls).toContainEqual({
      table: 'survey_questions',
      column: 'survey_id',
      values: ['survey-51'],
    })
    expect(statsInCalls).toContainEqual({
      table: 'survey_responses',
      column: 'survey_id',
      values: surveyRows.slice(0, 50).map((survey) => survey.id),
    })
    expect(statsInCalls).toContainEqual({
      table: 'survey_responses',
      column: 'survey_id',
      values: ['survey-51'],
    })
    expect(statsInCalls).toContainEqual({
      table: 'survey_responses',
      column: 'student_id',
      values: studentIds.slice(0, 50),
    })
    expect(statsInCalls).toContainEqual({
      table: 'survey_responses',
      column: 'student_id',
      values: ['student-51'],
    })
  })

  it('paginates survey stat rows inside each filter chunk', async () => {
    const questionRows = Array.from({ length: 1001 }, () => ({ survey_id: 'survey-1' }))
    const responseRows = [
      ...Array.from({ length: 1000 }, () => ({ survey_id: 'survey-1', student_id: 'student-1' })),
      { survey_id: 'survey-1', student_id: 'student-2' },
    ]
    const orderCalls: Array<{ table: string; column: string; ascending?: boolean }> = []
    const rangeCalls: Array<{ table: string; from: number; to: number }> = []

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'surveys') {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          then: vi.fn((resolve: any) =>
            resolve({
              data: [
                {
                  id: 'survey-1',
                  classroom_id: 'classroom-1',
                  title: 'Survey One',
                  status: 'active',
                  show_results: true,
                  dynamic_responses: false,
                  position: 0,
                  created_at: '2026-05-01T00:00:00.000Z',
                },
              ],
              error: null,
            })
          ),
        }
        return chain
      }

      if (table === 'survey_questions') {
        return buildSurveyIdStatsTable({
          table,
          rows: questionRows,
          filterColumn: 'survey_id',
          orderCalls,
          pageable: true,
          rangeCalls,
        })
      }

      if (table === 'survey_responses') {
        return buildStudentScopedSurveyStatsTable({
          table,
          rows: responseRows,
          orderCalls,
          pageable: true,
          rangeCalls,
        })
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/surveys?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.surveys[0].stats).toEqual({
      total_students: 2,
      responded: 2,
      questions_count: 1001,
    })
    expect(orderCalls).toEqual([
      { table: 'survey_questions', column: 'id', ascending: true },
      { table: 'survey_questions', column: 'id', ascending: true },
      { table: 'survey_responses', column: 'id', ascending: true },
      { table: 'survey_responses', column: 'id', ascending: true },
    ])
    expect(rangeCalls).toContainEqual({ table: 'survey_questions', from: 0, to: 999 })
    expect(rangeCalls).toContainEqual({ table: 'survey_questions', from: 1000, to: 1999 })
    expect(rangeCalls).toContainEqual({ table: 'survey_responses', from: 0, to: 999 })
    expect(rangeCalls).toContainEqual({ table: 'survey_responses', from: 1000, to: 1999 })
  })
})

describe('POST /api/teacher/surveys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates an untitled draft survey when no title is provided', async () => {
    const insertedSurvey = {
      id: 'survey-1',
      classroom_id: 'classroom-1',
      title: 'Untitled 2026-05-14 10:15:30',
      status: 'draft',
      opens_at: null,
      show_results: true,
      dynamic_responses: false,
      position: 3,
      created_by: 'teacher-1',
    }
    const insert = vi.fn((payload: Record<string, unknown>) => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { ...insertedSurvey, ...payload },
          error: null,
        }),
      })),
    }))
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { position: 1 }, error: null }),
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'classwork_materials') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { position: 2 }, error: null }),
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'surveys') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                })),
              })),
            })),
          })),
          insert,
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/surveys', {
        method: 'POST',
        body: JSON.stringify({ classroom_id: 'classroom-1', title: '   ' }),
      }),
    )

    expect(response.status).toBe(201)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      classroom_id: 'classroom-1',
      title: expect.stringMatching(/^Untitled \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
      show_results: true,
      dynamic_responses: false,
      created_by: 'teacher-1',
      position: 3,
    }))
    await expect(response.json()).resolves.toEqual({
      survey: expect.objectContaining({
        title: expect.stringMatching(/^Untitled \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
      }),
    })
  })

  it('requires migration instead of dropping due fields during survey creation', async () => {
    const insert = vi.fn((payload: Record<string, unknown>) => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: null,
          error: {
            code: 'PGRST204',
            message: "Could not find the 'due_at' column of 'surveys' in the schema cache",
          },
        }),
      })),
    }))
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { position: 1 }, error: null }),
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'classwork_materials') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { position: 2 }, error: null }),
                })),
              })),
            })),
          })),
        }
      }
      if (table === 'surveys') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                })),
              })),
            })),
          })),
          insert,
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/surveys', {
        method: 'POST',
        body: JSON.stringify({
          classroom_id: 'classroom-1',
          title: 'Weekly check-in',
          due_at: '2026-01-02T20:30:00.000Z',
          due_policy: 'soft',
        }),
      }),
    )
    const data = await response.json()

    expect(response.status).toBe(503)
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert.mock.calls[0][0]).toEqual(expect.objectContaining({
      due_at: '2026-01-02T20:30:00.000Z',
      due_policy: 'soft',
    }))
    expect(data).toEqual({
      error: 'Survey due dates are unavailable until migration 080 is applied.',
      code: 'SURVEY_DUE_MIGRATION_REQUIRED',
      migration_required: true,
    })
  })
})

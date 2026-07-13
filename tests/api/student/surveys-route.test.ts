import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as GET_SURVEY } from '@/app/api/student/surveys/[id]/route'
import { GET as GET_SURVEY_RESULTS } from '@/app/api/student/surveys/[id]/results/route'
import { POST as POST_SURVEY_RESPONSE } from '@/app/api/student/surveys/[id]/respond/route'

const mockSupabaseClient = { from: vi.fn() }
const mockSurveyState = vi.hoisted(() => ({
  survey: {
    id: 'survey-1',
    classroom_id: 'classroom-1',
    title: 'Game Jam Links',
    status: 'active',
    opens_at: null,
    due_at: null,
    due_policy: 'soft',
    show_results: true,
    dynamic_responses: true,
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
}))

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

vi.mock('@/lib/server/surveys', () => ({
  assertStudentCanAccessSurvey: vi.fn(async () => ({
    ok: true,
    survey: mockSurveyState.survey,
  })),
}))

describe('GET /api/student/surveys/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSurveyState.survey = {
      ...mockSurveyState.survey,
      status: 'active',
      opens_at: null,
      due_at: null,
      due_policy: 'soft',
      show_results: true,
      dynamic_responses: true,
    }
  })

  it('preserves link response discriminants in the student response map', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'survey_responses') {
        const responseFilter: any = {
          eq: vi.fn(() => responseFilter),
        }
        responseFilter.eq
          .mockReturnValueOnce(responseFilter)
          .mockResolvedValueOnce({
            data: [
              { question_id: 'link-question', selected_option: null, response_text: 'https://example.com/game' },
              { question_id: 'text-question', selected_option: null, response_text: 'Built in Godot' },
            ],
            error: null,
          })
        return {
          select: vi.fn(() => responseFilter),
        }
      }

      if (table === 'survey_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'link-question',
                  survey_id: 'survey-1',
                  question_type: 'link',
                  question_text: 'Share your game',
                  options: [],
                  response_max_chars: 2048,
                  position: 0,
                  created_at: '2026-01-01T00:00:00.000Z',
                  updated_at: '2026-01-01T00:00:00.000Z',
                },
                {
                  id: 'text-question',
                  survey_id: 'survey-1',
                  question_type: 'short_text',
                  question_text: 'What did you build?',
                  options: [],
                  response_max_chars: 500,
                  position: 1,
                  created_at: '2026-01-01T00:00:00.000Z',
                  updated_at: '2026-01-01T00:00:00.000Z',
                },
              ],
              error: null,
            }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET_SURVEY(
      new NextRequest('http://localhost:3000/api/student/surveys/survey-1'),
      { params: Promise.resolve({ id: 'survey-1' }) },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.student_responses['link-question']).toEqual({
      question_type: 'link',
      response_text: 'https://example.com/game',
    })
    expect(data.student_responses['text-question']).toEqual({
      question_type: 'short_text',
      response_text: 'Built in Godot',
    })
  })
})

describe('GET /api/student/surveys/[id]/results', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSurveyState.survey = {
      ...mockSurveyState.survey,
      status: 'active',
      opens_at: null,
      due_at: null,
      due_policy: 'soft',
      show_results: true,
      dynamic_responses: true,
    }
  })

  it('allows students to view class results before submitting when results are visible', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'survey_questions') {
        return mockPagedTable([])
      }

      if (table === 'survey_responses') {
        return {
          select: vi.fn((columns: string) => {
            if (columns !== '*') throw new Error(`Unexpected survey_responses columns: ${columns}`)
            return {
              eq: vi.fn().mockReturnThis(),
              in: vi.fn((column: string, studentIds: string[]) => {
                expect(column).toBe('student_id')
                expect(studentIds).toEqual(['student-1'])
                return Promise.resolve({ data: [], error: null })
              }),
            }
          }),
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

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET_SURVEY_RESULTS(
      new NextRequest('http://localhost:3000/api/student/surveys/survey-1/results'),
      { params: Promise.resolve({ id: 'survey-1' }) },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.results).toEqual([])
  })

  it('does not expose draft survey results even when show_results is enabled', async () => {
    mockSurveyState.survey = {
      ...mockSurveyState.survey,
      status: 'draft',
      show_results: true,
    }
    ;(mockSupabaseClient.from as any) = vi.fn()

    const response = await GET_SURVEY_RESULTS(
      new NextRequest('http://localhost:3000/api/student/surveys/survey-1/results'),
      { params: Promise.resolve({ id: 'survey-1' }) },
    )
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data).toEqual({ error: 'Results are not available' })
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })

  it('omits classmate student ids from text and link result payloads', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'survey_responses') {
        return {
          select: vi.fn((columns: string) => {
            if (columns === 'id') {
              return {
                eq: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue({ data: [{ id: 'own-response' }], error: null }),
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
                      {
                        id: 'response-1',
                        survey_id: 'survey-1',
                        question_id: 'link-question',
                        student_id: 'student-1',
                        selected_option: null,
                        response_text: 'https://example.com/game',
                        submitted_at: '2026-01-01T00:00:00.000Z',
                        updated_at: '2026-01-01T00:00:00.000Z',
                      },
                      {
                        id: 'response-2',
                        survey_id: 'survey-1',
                        question_id: 'link-question',
                        student_id: 'student-2',
                        selected_option: null,
                        response_text: 'https://example.com/other-game',
                        submitted_at: '2026-01-02T00:00:00.000Z',
                        updated_at: '2026-01-02T00:00:00.000Z',
                      },
                      {
                        id: 'response-stale',
                        survey_id: 'survey-1',
                        question_id: 'link-question',
                        student_id: 'student-removed',
                        selected_option: null,
                        response_text: 'https://example.com/removed-game',
                        submitted_at: '2026-01-02T12:00:00.000Z',
                        updated_at: '2026-01-02T12:00:00.000Z',
                      },
                      {
                        id: 'response-3',
                        survey_id: 'survey-1',
                        question_id: 'text-question',
                        student_id: 'student-1',
                        selected_option: null,
                        response_text: 'Built in Godot',
                        submitted_at: '2026-01-03T00:00:00.000Z',
                        updated_at: '2026-01-03T00:00:00.000Z',
                      },
                      {
                        id: 'response-4',
                        survey_id: 'survey-1',
                        question_id: 'text-question',
                        student_id: 'student-2',
                        selected_option: null,
                        response_text: 'Built in Phaser',
                        submitted_at: '2026-01-04T00:00:00.000Z',
                        updated_at: '2026-01-04T00:00:00.000Z',
                      },
                    ],
                    error: null,
                  })
                }),
              }
            }

            throw new Error(`Unexpected survey_responses columns: ${columns}`)
          }),
        }
      }

      if (table === 'survey_questions') {
        return mockPagedTable([
          {
            id: 'link-question',
            survey_id: 'survey-1',
            question_type: 'link',
            question_text: 'Share your game',
            options: [],
            response_max_chars: 2048,
            position: 0,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'text-question',
            survey_id: 'survey-1',
            question_type: 'short_text',
            question_text: 'What did you build?',
            options: [],
            response_max_chars: 500,
            position: 1,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
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

    const response = await GET_SURVEY_RESULTS(
      new NextRequest('http://localhost:3000/api/student/surveys/survey-1/results'),
      { params: Promise.resolve({ id: 'survey-1' }) },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.results[0].responses).toEqual([
      {
        response_id: 'response-1',
        response_text: 'https://example.com/game',
        submitted_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      {
        response_id: 'response-2',
        response_text: 'https://example.com/other-game',
        submitted_at: '2026-01-02T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
      },
    ])
    expect(data.results[1].responses).toEqual([
      {
        response_id: 'response-3',
        response_text: 'Built in Godot',
        submitted_at: '2026-01-03T00:00:00.000Z',
        updated_at: '2026-01-03T00:00:00.000Z',
      },
      {
        response_id: 'response-4',
        response_text: 'Built in Phaser',
        submitted_at: '2026-01-04T00:00:00.000Z',
        updated_at: '2026-01-04T00:00:00.000Z',
      },
    ])
  })

  it('returns 500 when scoped survey response loading fails', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'survey_questions') {
        return mockPagedTable([
          {
            id: 'choice-question',
            survey_id: 'survey-1',
            question_type: 'multiple_choice',
            question_text: 'Pick one',
            options: ['A', 'B'],
            response_max_chars: 500,
            position: 0,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ])
      }

      if (table === 'survey_responses') {
        return mockPagedTable([], { error: { message: 'boom' } })
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

    const response = await GET_SURVEY_RESULTS(
      new NextRequest('http://localhost:3000/api/student/surveys/survey-1/results'),
      { params: Promise.resolve({ id: 'survey-1' }) },
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to fetch responses' })
  })

  it('chunks enrolled student response filters and pages dense survey result rows', async () => {
    const studentIds = Array.from({ length: 51 }, (_, index) => `student-${index}`)
    const enrollments = studentIds.map((student_id) => ({ classroom_id: 'classroom-1', student_id }))
    const responses = [
      ...Array.from({ length: 1001 }, (_, index) => ({
        id: `response-page-${index}`,
        survey_id: 'survey-1',
        question_id: 'choice-question',
        student_id: 'student-0',
        selected_option: 0,
        response_text: null,
        submitted_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      })),
      {
        id: 'response-last-chunk',
        survey_id: 'survey-1',
        question_id: 'choice-question',
        student_id: 'student-50',
        selected_option: 1,
        response_text: null,
        submitted_at: '2026-01-02T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 'response-stale',
        survey_id: 'survey-1',
        question_id: 'choice-question',
        student_id: 'student-removed',
        selected_option: 1,
        response_text: null,
        submitted_at: '2026-01-03T00:00:00.000Z',
        updated_at: '2026-01-03T00:00:00.000Z',
      },
    ]
    const log = createQueryLog()

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'survey_questions') {
        return mockPagedTable([
          {
            id: 'choice-question',
            survey_id: 'survey-1',
            question_type: 'multiple_choice',
            question_text: 'Pick one',
            options: ['A', 'B'],
            response_max_chars: 500,
            position: 0,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ])
      }

      if (table === 'survey_responses') {
        return mockPagedTable(responses, { table, log })
      }

      if (table === 'classroom_enrollments') {
        return mockPagedTable(enrollments, { table, log })
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET_SURVEY_RESULTS(
      new NextRequest('http://localhost:3000/api/student/surveys/survey-1/results'),
      { params: Promise.resolve({ id: 'survey-1' }) },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.results[0]).toEqual(
      expect.objectContaining({
        counts: [1001, 1],
        total_responses: 1002,
      })
    )
    expect(log.inCalls.filter((call) => call.table === 'survey_responses').map((call) => call.values.length))
      .toEqual([50, 50, 1])
    expect(log.rangeCalls.filter((call) => call.table === 'survey_responses')).toEqual([
      { table: 'survey_responses', from: 0, to: 999 },
      { table: 'survey_responses', from: 1000, to: 1999 },
      { table: 'survey_responses', from: 0, to: 999 },
    ])
  })
})

describe('POST /api/student/surveys/[id]/respond', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSurveyState.survey = {
      ...mockSurveyState.survey,
      status: 'active',
      opens_at: null,
      due_at: '2020-01-01T14:00:00.000Z',
      due_policy: 'hard',
      show_results: true,
      dynamic_responses: true,
    }
  })

  it('uses response-editing settings instead of legacy hard due policy', async () => {
    mockSurveyState.survey = {
      ...mockSurveyState.survey,
      dynamic_responses: false,
    }
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table !== 'survey_responses') {
        throw new Error(`Unexpected table: ${table}`)
      }

      const query: any = {
        eq: vi.fn(() => query),
        limit: vi.fn().mockResolvedValue({ data: [{ id: 'response-1' }], error: null }),
      }
      return {
        select: vi.fn((columns: string) => {
          expect(columns).toBe('id')
          return query
        }),
      }
    })

    const response = await POST_SURVEY_RESPONSE(
      new NextRequest('http://localhost:3000/api/student/surveys/survey-1/respond', {
        method: 'POST',
        body: JSON.stringify({ responses: { 'question-1': 0 } }),
      }),
      { params: Promise.resolve({ id: 'survey-1' }) },
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ error: 'You have already responded to this survey' })
    expect(mockSupabaseClient.from).toHaveBeenCalledTimes(1)
  })
})

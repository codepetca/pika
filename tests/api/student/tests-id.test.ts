import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/student/tests/[id]/route'

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

vi.mock('@/lib/server/tests', () => ({
  isMissingTestAttemptReturnColumnsError: vi.fn((error: { code?: string; message?: string } | null | undefined) => {
    if (!error) return false
    const message = (error.message || '').toLowerCase()
    return error.code === 'PGRST204' && message.includes('returned_at')
  }),
  assertStudentCanAccessTest: vi.fn(async () => ({
    ok: true,
    test: {
      id: 'test-1',
      classroom_id: 'classroom-1',
      title: 'Unit Test',
      status: 'active',
      show_results: false,
      position: 0,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/student/tests/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 500 when checking submitted test responses fails', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        }
      }
      if (table === 'test_responses') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database error' },
            }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/tests/test-1'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to fetch test progress')
  })

  it('returns 500 when loading submitted response details fails', async () => {
    let responseReadCount = 0

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { responses: {}, is_submitted: true },
              error: null,
            }),
          })),
        }
      }
      if (table === 'test_responses') {
        responseReadCount += 1
        if (responseReadCount === 1) {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({
                data: [{ id: 'response-1' }],
                error: null,
              }),
            })),
          }
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            mockResolvedValue: vi.fn(),
            then: vi.fn((resolve: any) =>
              resolve({ data: null, error: { message: 'Database error' } })
            ),
          })),
        }
      }
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/tests/test-1'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to fetch test progress')
  })

  it('falls back when test_attempts return columns are missing', async () => {
    let questionSelectColumns = ''
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_attempts') {
        return {
          select: vi.fn((columns: string) => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue(
              columns.includes('returned_at')
                ? {
                    data: null,
                    error: {
                      code: 'PGRST204',
                      message: "Could not find column 'returned_at'",
                    },
                  }
                : {
                    data: {
                      responses: {},
                      is_submitted: true,
                    },
                    error: null,
                  }
            ),
          })),
        }
      }
      if (table === 'test_responses') {
        let isLimitQuery = false
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn(() => {
              isLimitQuery = true
              return Promise.resolve({
                data: [{ id: 'response-1' }],
                error: null,
              })
            }),
            then: vi.fn((resolve: any) =>
              resolve(
                isLimitQuery
                  ? { data: [{ id: 'response-1' }], error: null }
                  : { data: [], error: null }
              )
            ),
          })),
        }
      }
      if (table === 'test_questions') {
        return {
          select: vi.fn((columns: string) => {
            questionSelectColumns = columns
            return ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'question-1',
                  test_id: 'test-1',
                  question_type: 'multiple_choice',
                  question_text: 'Q1',
                  options: ['A', 'B'],
                  points: 1,
                  response_max_chars: 5000,
                  response_monospace: false,
                  position: 0,
                  created_at: '2026-01-01T00:00:00.000Z',
                  updated_at: '2026-01-01T00:00:00.000Z',
                },
              ],
              error: null,
            }),
          })}),
        }
      }
      if (table === 'test_focus_events') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/tests/test-1'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.quiz.id).toBe('test-1')
    expect(data.quiz.returned_at).toBeNull()
    expect(questionSelectColumns).not.toContain('correct_option')
    expect(questionSelectColumns).not.toContain('answer_key')
    expect(data.questions[0].correct_option).toBeUndefined()
    expect(data.questions[0].answer_key).toBeUndefined()
  })

  it('returns student_status=responded when closed test is submitted but not returned', async () => {
    const serverTests = await import('@/lib/server/tests')
    vi.mocked(serverTests.assertStudentCanAccessTest).mockResolvedValueOnce({
      ok: true,
      test: {
        id: 'test-1',
        classroom_id: 'classroom-1',
        title: 'Unit Test',
        status: 'closed',
        show_results: false,
        position: 0,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    } as any)

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { responses: {}, is_submitted: true, returned_at: null },
              error: null,
            }),
          })),
        }
      }
      if (table === 'test_responses') {
        let isLimitQuery = false
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn(() => {
              isLimitQuery = true
              return Promise.resolve({ data: [], error: null })
            }),
            then: vi.fn((resolve: any) =>
              resolve(
                isLimitQuery
                  ? { data: [], error: null }
                  : { data: [], error: null }
              )
            ),
          })),
        }
      }
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }
      if (table === 'test_focus_events') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/tests/test-1'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.student_status).toBe('responded')
    expect(data.quiz.student_status).toBe('responded')
  })

  it('returns student_status=can_view_results when closed test has been returned', async () => {
    const serverTests = await import('@/lib/server/tests')
    vi.mocked(serverTests.assertStudentCanAccessTest).mockResolvedValueOnce({
      ok: true,
      test: {
        id: 'test-1',
        classroom_id: 'classroom-1',
        title: 'Unit Test',
        status: 'closed',
        show_results: false,
        position: 0,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    } as any)

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                responses: {},
                is_submitted: true,
                returned_at: '2026-03-05T12:00:00.000Z',
              },
              error: null,
            }),
          })),
        }
      }
      if (table === 'test_responses') {
        let isLimitQuery = false
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn(() => {
              isLimitQuery = true
              return Promise.resolve({ data: [], error: null })
            }),
            then: vi.fn((resolve: any) =>
              resolve(
                isLimitQuery
                  ? { data: [], error: null }
                  : { data: [], error: null }
              )
            ),
          })),
        }
      }
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }
      if (table === 'test_focus_events') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/tests/test-1'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.student_status).toBe('can_view_results')
    expect(data.quiz.student_status).toBe('can_view_results')
  })
})

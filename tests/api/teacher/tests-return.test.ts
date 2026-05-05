import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/tests/[id]/return/route'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { finalizeUnsubmittedTestAttemptsOnClose } from '@/lib/server/finalize-test-attempts'

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
        title: 'Unit Test',
        status: 'closed',
        classroom_id: 'classroom-1',
        classrooms: { archived_at: null },
      },
    })),
    isMissingTestAttemptReturnColumnsError: vi.fn((error: { code?: string; message?: string } | null) => {
      if (!error) return false
      const message = `${error.message || ''}`.toLowerCase()
      return (error.code === 'PGRST204' || error.code === '42703') && message.includes('returned_at')
    }),
  }
})

vi.mock('@/lib/server/finalize-test-attempts', () => ({
  finalizeUnsubmittedTestAttemptsOnClose: vi.fn(async () => ({
    ok: true,
    finalized_attempts: 0,
    inserted_responses: 0,
  })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/teacher/tests/[id]/return', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when student_ids is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/return', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('student_ids array is required')
  })

  it('returns only students whose open responses are fully graded', async () => {
    const updatedStudentIds: string[][] = []
    const insertedRows: Array<{ test_id: string; student_id: string }> = []

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        const query = {
          eq: vi.fn().mockReturnThis(),
        } as any
        query.eq.mockImplementationOnce(() => query)
        query.eq.mockImplementationOnce(async () => ({
          data: [{ id: 'q-open-1' }],
          error: null,
        }))
        return {
          select: vi.fn(() => query),
        }
      }

      if (table === 'test_responses') {
        const query = {
          eq: vi.fn().mockReturnThis(),
          in: vi.fn(async () => ({
            data: [
              {
                student_id: 'student-1',
                question_id: 'q-open-1',
                score: 5,
                feedback: 'Great',
                submitted_at: '2026-02-24T15:00:00.000Z',
              },
              {
                student_id: 'student-2',
                question_id: 'q-open-1',
                score: null,
                feedback: null,
                submitted_at: '2026-02-24T15:01:00.000Z',
              },
            ],
            error: null,
          })),
        }
        return {
          select: vi.fn(() => query),
        }
      }

      if (table === 'test_attempts') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(async (_column: string, ids: string[]) => {
                updatedStudentIds.push(ids)
                return { error: null }
              }),
            })),
          })),
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn(async () => ({
              data: [],
              error: null,
            })),
          })),
          insert: vi.fn(async (rows: Array<{ test_id: string; student_id: string }>) => {
            insertedRows.push(...rows)
            return { error: null }
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/return', {
      method: 'POST',
      body: JSON.stringify({ student_ids: ['student-1', 'student-2'] }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.returned_count).toBe(1)
    expect(data.skipped_count).toBe(1)
    expect(updatedStudentIds).toEqual([['student-1']])
    expect(insertedRows).toEqual([
      expect.objectContaining({
        test_id: 'test-1',
        student_id: 'student-1',
      }),
    ])
  })

  it('treats score-only open responses as graded for return eligibility', async () => {
    const updatedStudentIds: string[][] = []

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        const query = {
          eq: vi.fn().mockReturnThis(),
        } as any
        query.eq.mockImplementationOnce(() => query)
        query.eq.mockImplementationOnce(async () => ({
          data: [{ id: 'q-open-1' }],
          error: null,
        }))
        return {
          select: vi.fn(() => query),
        }
      }

      if (table === 'test_responses') {
        const query = {
          eq: vi.fn().mockReturnThis(),
          in: vi.fn(async () => ({
            data: [
              {
                student_id: 'student-1',
                question_id: 'q-open-1',
                score: 4,
                feedback: null,
                submitted_at: '2026-02-24T15:00:00.000Z',
              },
            ],
            error: null,
          })),
        }
        return {
          select: vi.fn(() => query),
        }
      }

      if (table === 'test_attempts') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(async (_column: string, ids: string[]) => {
                updatedStudentIds.push(ids)
                return { error: null }
              }),
            })),
          })),
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn(async () => ({
              data: [{ student_id: 'student-1' }],
              error: null,
            })),
          })),
          insert: vi.fn(async () => ({ error: null })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/return', {
      method: 'POST',
      body: JSON.stringify({ student_ids: ['student-1'] }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.returned_count).toBe(1)
    expect(data.skipped_count).toBe(0)
    expect(updatedStudentIds).toEqual([['student-1']])
  })

  it('returns submitted students with empty finalized responses', async () => {
    const updatedStudentIds: string[][] = []
    const insertSpy = vi.fn(async () => ({ error: null }))

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        const query = {
          eq: vi.fn().mockReturnThis(),
        } as any
        query.eq.mockImplementationOnce(() => query)
        query.eq.mockImplementationOnce(async () => ({
          data: [{ id: 'q-open-1' }],
          error: null,
        }))
        return {
          select: vi.fn(() => query),
        }
      }

      if (table === 'test_responses') {
        const query = {
          eq: vi.fn().mockReturnThis(),
          in: vi.fn(async () => ({
            data: [],
            error: null,
          })),
        }
        return {
          select: vi.fn(() => query),
        }
      }

      if (table === 'test_attempts') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(async (_column: string, ids: string[]) => {
                updatedStudentIds.push(ids)
                return { error: null }
              }),
            })),
          })),
          select: vi.fn((columns: string) => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn(async () => {
              if (columns.includes('is_submitted')) {
                return {
                  data: [
                    {
                      student_id: 'student-empty',
                      is_submitted: true,
                      submitted_at: '2026-02-24T15:00:00.000Z',
                    },
                  ],
                  error: null,
                }
              }

              return {
                data: [{ student_id: 'student-empty' }],
                error: null,
              }
            }),
          })),
          insert: insertSpy,
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/return', {
      method: 'POST',
      body: JSON.stringify({ student_ids: ['student-empty'] }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.returned_count).toBe(1)
    expect(data.skipped_count).toBe(0)
    expect(updatedStudentIds).toEqual([['student-empty']])
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('returns 409 for active tests while selected students still have open access', async () => {
    vi.mocked(assertTeacherOwnsTest).mockResolvedValueOnce({
      ok: true,
      test: {
        id: 'test-1',
        title: 'Unit Test',
        status: 'active',
        classroom_id: 'classroom-1',
        classrooms: { archived_at: null },
      } as any,
    })
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_student_availability') {
        throw new Error(`Unexpected table: ${table}`)
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/return', {
      method: 'POST',
      body: JSON.stringify({ student_ids: ['student-1'] }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('Close selected students before returning their test work.')
  })

  it('returns selected work during an active test after selected access is closed', async () => {
    vi.mocked(assertTeacherOwnsTest).mockResolvedValueOnce({
      ok: true,
      test: {
        id: 'test-1',
        title: 'Unit Test',
        status: 'active',
        classroom_id: 'classroom-1',
        classrooms: { archived_at: null },
      } as any,
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_student_availability') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn(async () => ({
              data: [{ student_id: 'student-1', state: 'closed' }],
              error: null,
            })),
          })),
        }
      }

      if (table === 'test_questions') {
        const query = {
          eq: vi.fn().mockReturnThis(),
        } as any
        query.eq.mockImplementationOnce(() => query)
        query.eq.mockImplementationOnce(async () => ({
          data: [],
          error: null,
        }))
        return {
          select: vi.fn(() => query),
        }
      }

      if (table === 'test_responses') {
        const query = {
          eq: vi.fn().mockReturnThis(),
          in: vi.fn(async () => ({
            data: [
              {
                student_id: 'student-1',
                question_id: 'q-1',
                score: null,
                feedback: null,
                submitted_at: '2026-02-24T15:00:00.000Z',
              },
            ],
            error: null,
          })),
        }
        return {
          select: vi.fn(() => query),
        }
      }

      if (table === 'test_attempts') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(async () => ({ error: null })),
            })),
          })),
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn(async () => ({
              data: [],
              error: null,
            })),
          })),
          insert: vi.fn(async () => ({ error: null })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/return', {
      method: 'POST',
      body: JSON.stringify({ student_ids: ['student-1'] }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.test_closed).toBe(false)
    expect(finalizeUnsubmittedTestAttemptsOnClose).not.toHaveBeenCalled()
  })

  it('returns migration error when returned_at column is missing', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        const query = {
          eq: vi.fn().mockReturnThis(),
        } as any
        query.eq.mockImplementationOnce(() => query)
        query.eq.mockImplementationOnce(async () => ({
          data: [],
          error: null,
        }))
        return {
          select: vi.fn(() => query),
        }
      }

      if (table === 'test_responses') {
        const query = {
          eq: vi.fn().mockReturnThis(),
          in: vi.fn(async () => ({
            data: [
              {
                student_id: 'student-1',
                question_id: 'q-1',
                score: null,
                feedback: null,
                submitted_at: '2026-02-24T15:00:00.000Z',
              },
            ],
            error: null,
          })),
        }
        return {
          select: vi.fn(() => query),
        }
      }

      if (table === 'test_attempts') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(async () => ({
                error: {
                  code: 'PGRST204',
                  message:
                    "Could not find the 'returned_at' column of 'test_attempts' in the schema cache",
                },
              })),
            })),
          })),
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn(async () => ({
              data: [],
              error: null,
            })),
          })),
          insert: vi.fn(async () => ({ error: null })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/return', {
      method: 'POST',
      body: JSON.stringify({ student_ids: ['student-1'] }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Returning tests requires migration 043 to be applied')
  })

  it('returns finalize failure for closed tests', async () => {
    vi.mocked(finalizeUnsubmittedTestAttemptsOnClose).mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: 'Failed to finalize test submissions',
    } as any)

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_student_availability') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn(async () => ({
              data: [],
              error: null,
            })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/return', {
      method: 'POST',
      body: JSON.stringify({ student_ids: ['student-1'] }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to finalize test submissions')
  })
})

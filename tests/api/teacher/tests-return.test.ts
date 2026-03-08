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

vi.mock('@/lib/server/tests', () => ({
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
}))

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

  it('returns 409 for active tests when close_test is not provided', async () => {
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

    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/return', {
      method: 'POST',
      body: JSON.stringify({ student_ids: ['student-1'] }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('Test is still active. Confirm close and return to close it first.')
  })

  it('closes active tests when close_test is provided', async () => {
    const closeUpdates: Array<{ status: string }> = []

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
      if (table === 'tests') {
        return {
          update: vi.fn((payload: { status: string }) => {
            closeUpdates.push(payload)
            return {
              eq: vi.fn(() => ({
                eq: vi.fn(async () => ({ error: null })),
              })),
            }
          }),
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
      body: JSON.stringify({ student_ids: ['student-1'], close_test: true }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.test_closed).toBe(true)
    expect(closeUpdates).toEqual([{ status: 'closed' }])
    expect(finalizeUnsubmittedTestAttemptsOnClose).toHaveBeenCalledWith(mockSupabaseClient, 'test-1')
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

  it('reopens active test when close+return finalization fails', async () => {
    const statusUpdates: Array<{ status: string }> = []

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

    vi.mocked(finalizeUnsubmittedTestAttemptsOnClose).mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: 'Failed to finalize test submissions',
    } as any)

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          update: vi.fn((payload: { status: string }) => {
            statusUpdates.push(payload)
            return {
              eq: vi.fn(() => ({
                eq: vi.fn(async () => ({ error: null })),
              })),
            }
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/return', {
      method: 'POST',
      body: JSON.stringify({ student_ids: ['student-1'], close_test: true }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to finalize test submissions')
    expect(statusUpdates).toEqual([{ status: 'closed' }, { status: 'active' }])
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/teacher/tests/route'

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
    classroom: { id: 'classroom-1', teacher_id: 'teacher-1' },
  })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/teacher/tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requests tests in descending position order with a descending created_at tie-breaker', async () => {
    const orderCalls: Array<{ column: string; ascending: boolean | undefined }> = []

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        const builder: any = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          order: vi.fn((column: string, options?: { ascending?: boolean }) => {
            orderCalls.push({ column, ascending: options?.ascending })
            return builder
          }),
          then: vi.fn((resolve: any) =>
            resolve({
              data: [
                { id: 'test-2', classroom_id: 'classroom-1', title: 'Newest', position: 2, created_at: '2026-03-02T00:00:00.000Z' },
                { id: 'test-1', classroom_id: 'classroom-1', title: 'Older', position: 1, created_at: '2026-03-01T00:00:00.000Z' },
              ],
              error: null,
            })
          ),
        }
        return builder
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
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

      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }

      if (table === 'test_responses') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(orderCalls).toEqual([
      { column: 'position', ascending: false },
      { column: 'created_at', ascending: false },
    ])
    expect((data.quizzes as Array<{ id: string }>).map((quiz) => quiz.id)).toEqual(['test-2', 'test-1'])
  })

  it('returns 500 when reading test responses fails', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            then: vi.fn((resolve: any) =>
              resolve({
                data: [{ id: 'test-1', classroom_id: 'classroom-1', title: 'T1', position: 0 }],
                error: null,
              })
            ),
          })),
        }
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ count: 10, error: null }),
          })),
        }
      }

      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [{ test_id: 'test-1' }], error: null }),
          })),
        }
      }

      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [{ test_id: 'test-1', student_id: 'student-1', is_submitted: true }],
              error: null,
            }),
          })),
        }
      }

      if (table === 'test_responses') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database error' },
            }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to fetch tests')
  })

  it('does not count placeholder graded rows as respondents', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            then: vi.fn((resolve: any) =>
              resolve({
                data: [{ id: 'test-1', classroom_id: 'classroom-1', title: 'T1', position: 0 }],
                error: null,
              })
            ),
          })),
        }
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ count: 10, error: null }),
          })),
        }
      }

      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [{ test_id: 'test-1' }], error: null }),
          })),
        }
      }

      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          })),
        }
      }

      if (table === 'test_responses') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  test_id: 'test-1',
                  student_id: 'student-1',
                  selected_option: null,
                  response_text: '   ',
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
      new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.quizzes).toHaveLength(1)
    expect(data.quizzes[0].stats.responded).toBe(0)
  })

  it('counts only currently enrolled students as respondents', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            then: vi.fn((resolve: any) =>
              resolve({
                data: [{ id: 'test-1', classroom_id: 'classroom-1', title: 'T1', position: 0 }],
                error: null,
              })
            ),
          })),
        }
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [{ student_id: 'student-1' }, { student_id: 'student-2' }],
              count: 2,
              error: null,
            }),
          })),
        }
      }

      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [{ test_id: 'test-1' }], error: null }),
          })),
        }
      }

      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [
                { test_id: 'test-1', student_id: 'student-1', is_submitted: true },
                { test_id: 'test-1', student_id: 'student-3', is_submitted: true },
              ],
              error: null,
            }),
          })),
        }
      }

      if (table === 'test_responses') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  test_id: 'test-1',
                  student_id: 'student-2',
                  selected_option: 0,
                  response_text: null,
                },
                {
                  test_id: 'test-1',
                  student_id: 'student-4',
                  selected_option: 1,
                  response_text: null,
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
      new NextRequest('http://localhost:3000/api/teacher/tests?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.quizzes).toHaveLength(1)
    expect(data.quizzes[0].stats.total_students).toBe(2)
    expect(data.quizzes[0].stats.responded).toBe(2)
  })
})

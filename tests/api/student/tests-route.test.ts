import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/student/tests/route'

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

vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'classroom-1' },
  })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/student/tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 500 when reading submitted test responses fails', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        let statusFilter: string | null = null
        const builder: any = {
          select: vi.fn(() => builder),
          eq: vi.fn((column: string, value: string) => {
            if (column === 'status') statusFilter = value
            return builder
          }),
          order: vi.fn(() => builder),
          then: vi.fn((resolve: any) => {
            if (statusFilter === 'active') {
              resolve({ data: [{ id: 'test-1', status: 'active', title: 'T1' }], error: null })
              return
            }
            resolve({ data: [], error: null })
          }),
        }
        return builder
      }

      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }

      if (table === 'test_responses') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
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
      new NextRequest('http://localhost:3000/api/student/tests?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to fetch tests')
  })

  it('falls back when test_attempts return columns are missing', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        let statusFilter: string | null = null
        const builder: any = {
          select: vi.fn(() => builder),
          eq: vi.fn((column: string, value: string) => {
            if (column === 'status') statusFilter = value
            return builder
          }),
          order: vi.fn(() => builder),
          then: vi.fn((resolve: any) => {
            if (statusFilter === 'active') {
              resolve({
                data: [
                  {
                    id: 'test-1',
                    classroom_id: 'classroom-1',
                    title: 'Unit Test',
                    status: 'active',
                    show_results: false,
                    position: 0,
                    points_possible: 10,
                    include_in_final: true,
                    created_by: 'teacher-1',
                    created_at: '2026-02-01T00:00:00.000Z',
                    updated_at: '2026-02-01T00:00:00.000Z',
                  },
                ],
                error: null,
              })
              return
            }
            resolve({ data: [], error: null })
          }),
        }
        return builder
      }

      if (table === 'test_attempts') {
        return {
          select: vi.fn((columns: string) => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue(
              columns.includes('returned_at')
                ? {
                    data: null,
                    error: {
                      code: 'PGRST204',
                      message: "Could not find column 'returned_at'",
                    },
                  }
                : {
                    data: [{ test_id: 'test-1', is_submitted: true }],
                    error: null,
                  }
            ),
          })),
        }
      }

      if (table === 'test_responses') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: [{ test_id: 'test-1' }], error: null }),
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

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/tests?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.quizzes).toHaveLength(1)
    expect(data.quizzes[0].id).toBe('test-1')
  })
})

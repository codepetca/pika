/**
 * API tests for GET /api/student/classrooms/[id]/lesson-plans
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/student/classrooms/[id]/lesson-plans/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'student-1' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/timezone', () => ({
  nowInToronto: vi.fn(() => new Date('2025-01-15T12:00:00')), // Wednesday
}))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/student/classrooms/[id]/lesson-plans', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 400 when start param is missing', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/lesson-plans?end=2025-01-31'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('start and end')
  })

  it('should return 400 when end param is missing', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/lesson-plans?start=2025-01-01'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('start and end')
  })

  it('should return 403 when student cannot access classroom', async () => {
    const { assertStudentCanAccessClassroom } = await import('@/lib/server/classrooms')
    ;(assertStudentCanAccessClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })

    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/lesson-plans?start=2025-01-01&end=2025-01-31'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(403)
  })

  it('should return lesson plans with visibility=all (no restrictions)', async () => {
    const mockLessonPlans = [
      { id: 'lp-1', classroom_id: 'c-1', date: '2025-01-06', content: { type: 'doc', content: [] } },
      { id: 'lp-2', classroom_id: 'c-1', date: '2025-02-15', content: { type: 'doc', content: [] } },
    ]

    const selectMock = vi.fn(() => ({
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn(() => ({
        order: vi.fn().mockResolvedValue({ data: mockLessonPlans, error: null }),
      })),
      single: vi.fn().mockResolvedValue({
        data: { lesson_plan_visibility: 'all' },
        error: null,
      }),
    }))

    const mockFrom = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { lesson_plan_visibility: 'all' },
                error: null,
              }),
            })),
          })),
        }
      }
      return { select: selectMock }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/lesson-plans?start=2025-01-01&end=2025-02-28'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.visibility).toBe('all')
    expect(data.max_date).toBeNull()
    expect(data.lesson_plans).toHaveLength(2)
  })

  it('should clamp end date for current_week visibility', async () => {
    // nowInToronto returns Wed Jan 15, 2025
    // Current week ends Saturday Jan 18, 2025
    const mockLessonPlans = [
      { id: 'lp-1', classroom_id: 'c-1', date: '2025-01-15', content: { type: 'doc', content: [] } },
    ]

    let capturedEndDate: string | undefined
    const mockFrom = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { lesson_plan_visibility: 'current_week' },
                error: null,
              }),
            })),
          })),
        }
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            gte: vi.fn(() => ({
              lte: vi.fn((col: string, val: string) => {
                capturedEndDate = val
                return {
                  order: vi.fn().mockResolvedValue({ data: mockLessonPlans, error: null }),
                }
              }),
            })),
          })),
        })),
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/lesson-plans?start=2025-01-13&end=2025-01-31'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.visibility).toBe('current_week')
    expect(data.max_date).toBe('2025-01-18') // Saturday of current week
    expect(capturedEndDate).toBe('2025-01-18') // End date was clamped
  })

  it('should return empty for start date beyond max_date', async () => {
    // nowInToronto returns Wed Jan 15, 2025
    // Current week ends Saturday Jan 18, 2025
    const mockFrom = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { lesson_plan_visibility: 'current_week' },
                error: null,
              }),
            })),
          })),
        }
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            gte: vi.fn(() => ({
              lte: vi.fn(() => ({
                order: vi.fn().mockResolvedValue({ data: [], error: null }),
              })),
            })),
          })),
        })),
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    // Requesting dates starting Feb 1, beyond max_date of Jan 18
    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/lesson-plans?start=2025-02-01&end=2025-02-28'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.lesson_plans).toHaveLength(0)
    expect(data.max_date).toBe('2025-01-18')
  })

  it('should extend max_date for one_week_ahead visibility', async () => {
    // nowInToronto returns Wed Jan 15, 2025
    // Current week ends Saturday Jan 18, 2025
    // One week ahead ends Saturday Jan 25, 2025
    const mockFrom = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { lesson_plan_visibility: 'one_week_ahead' },
                error: null,
              }),
            })),
          })),
        }
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            gte: vi.fn(() => ({
              lte: vi.fn(() => ({
                order: vi.fn().mockResolvedValue({ data: [], error: null }),
              })),
            })),
          })),
        })),
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/lesson-plans?start=2025-01-13&end=2025-01-31'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.visibility).toBe('one_week_ahead')
    expect(data.max_date).toBe('2025-01-25') // Saturday of next week
  })

  it('should return 401 when not authenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    const authError = new Error('Not authenticated')
    authError.name = 'AuthenticationError'
    ;(requireRole as any).mockRejectedValueOnce(authError)

    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/lesson-plans?start=2025-01-01&end=2025-01-31'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(401)
  })

  it('should return 404 when classroom not found', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-999/lesson-plans?start=2025-01-01&end=2025-01-31'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-999' }) })
    expect(response.status).toBe(404)
  })

  it('should default to current_week when visibility is null', async () => {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { lesson_plan_visibility: null },
                error: null,
              }),
            })),
          })),
        }
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            gte: vi.fn(() => ({
              lte: vi.fn(() => ({
                order: vi.fn().mockResolvedValue({ data: [], error: null }),
              })),
            })),
          })),
        })),
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/student/classrooms/c-1/lesson-plans?start=2025-01-13&end=2025-01-31'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.visibility).toBe('current_week')
    expect(data.max_date).toBe('2025-01-18')
  })
})

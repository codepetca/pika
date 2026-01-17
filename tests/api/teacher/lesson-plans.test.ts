/**
 * API tests for GET /api/teacher/classrooms/[id]/lesson-plans
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/teacher/classrooms/[id]/lesson-plans/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherOwnsClassroom: vi.fn(async () => ({ ok: true })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/teacher/classrooms/[id]/lesson-plans', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 400 when start param is missing', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans?end=2025-01-31'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('start and end')
  })

  it('should return 400 when end param is missing', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans?start=2025-01-01'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('start and end')
  })

  it('should return 403 when teacher does not own classroom', async () => {
    const { assertTeacherOwnsClassroom } = await import('@/lib/server/classrooms')
    ;(assertTeacherOwnsClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans?start=2025-01-01&end=2025-01-31'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(403)
  })

  it('should return lesson plans for date range', async () => {
    const mockLessonPlans = [
      { id: 'lp-1', classroom_id: 'c-1', date: '2025-01-06', content: { type: 'doc', content: [] } },
      { id: 'lp-2', classroom_id: 'c-1', date: '2025-01-07', content: { type: 'doc', content: [] } },
    ]

    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          gte: vi.fn(() => ({
            lte: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({ data: mockLessonPlans, error: null }),
            })),
          })),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans?start=2025-01-01&end=2025-01-31'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.lesson_plans).toHaveLength(2)
    expect(data.lesson_plans[0].date).toBe('2025-01-06')
  })

  it('should return 401 when not authenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    const authError = new Error('Not authenticated')
    authError.name = 'AuthenticationError'
    ;(requireRole as any).mockRejectedValueOnce(authError)

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans?start=2025-01-01&end=2025-01-31'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(401)
  })

  it('should return 500 on database error', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          gte: vi.fn(() => ({
            lte: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
            })),
          })),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans?start=2025-01-01&end=2025-01-31'
    )
    const response = await GET(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(500)
  })
})

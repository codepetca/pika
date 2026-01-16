/**
 * API tests for PUT /api/teacher/classrooms/[id]/lesson-plans/bulk
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PUT } from '@/app/api/teacher/classrooms/[id]/lesson-plans/bulk/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherCanMutateClassroom: vi.fn(async () => ({ ok: true })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('PUT /api/teacher/classrooms/[id]/lesson-plans/bulk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 400 when plans array is missing', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/bulk',
      {
        method: 'PUT',
        body: JSON.stringify({}),
      }
    )
    const response = await PUT(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('plans array is required')
  })

  it('should return 400 when plans array is empty', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/bulk',
      {
        method: 'PUT',
        body: JSON.stringify({ plans: [] }),
      }
    )
    const response = await PUT(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('plans array is required')
  })

  it('should return 400 when plans exceed max limit (250)', async () => {
    const plans = Array.from({ length: 251 }, (_, i) => ({
      date: `2025-01-${String(i % 28 + 1).padStart(2, '0')}`,
      content: { type: 'doc', content: [] },
    }))

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/bulk',
      {
        method: 'PUT',
        body: JSON.stringify({ plans }),
      }
    )
    const response = await PUT(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('Maximum is 250')
  })

  it('should return 400 for invalid date format in plans', async () => {
    const plans = [
      { date: 'invalid-date', content: { type: 'doc', content: [] } },
    ]

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/bulk',
      {
        method: 'PUT',
        body: JSON.stringify({ plans }),
      }
    )
    const response = await PUT(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.errors).toContain('Invalid date format: invalid-date')
  })

  it('should return 400 for duplicate dates in plans', async () => {
    const plans = [
      { date: '2025-01-06', content: { type: 'doc', content: [] } },
      { date: '2025-01-06', content: { type: 'doc', content: [] } },
    ]

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/bulk',
      {
        method: 'PUT',
        body: JSON.stringify({ plans }),
      }
    )
    const response = await PUT(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.errors).toContain('Duplicate date: 2025-01-06')
  })

  it('should return 400 for invalid content in plans', async () => {
    const plans = [
      { date: '2025-01-06', content: { type: 'invalid', content: [] } },
    ]

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/bulk',
      {
        method: 'PUT',
        body: JSON.stringify({ plans }),
      }
    )
    const response = await PUT(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.errors).toContain('Invalid content for date 2025-01-06')
  })

  it('should return 403 when teacher cannot mutate classroom', async () => {
    const { assertTeacherCanMutateClassroom } = await import('@/lib/server/classrooms')
    ;(assertTeacherCanMutateClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })

    const plans = [
      { date: '2025-01-06', content: { type: 'doc', content: [] } },
    ]

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/bulk',
      {
        method: 'PUT',
        body: JSON.stringify({ plans }),
      }
    )
    const response = await PUT(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(403)
  })

  it('should bulk upsert lesson plans successfully', async () => {
    const mockResults = [
      { id: 'lp-1', classroom_id: 'c-1', date: '2025-01-06', content: { type: 'doc', content: [] } },
      { id: 'lp-2', classroom_id: 'c-1', date: '2025-01-07', content: { type: 'doc', content: [] } },
    ]

    const mockFrom = vi.fn(() => ({
      upsert: vi.fn(() => ({
        select: vi.fn().mockResolvedValue({ data: mockResults, error: null }),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const plans = [
      { date: '2025-01-06', content: { type: 'doc', content: [] } },
      { date: '2025-01-07', content: { type: 'doc', content: [] } },
    ]

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/bulk',
      {
        method: 'PUT',
        body: JSON.stringify({ plans }),
      }
    )
    const response = await PUT(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.updated).toBe(2)
    expect(data.lesson_plans).toHaveLength(2)
  })

  it('should return 401 when not authenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    const authError = new Error('Not authenticated')
    authError.name = 'AuthenticationError'
    ;(requireRole as any).mockRejectedValueOnce(authError)

    const plans = [
      { date: '2025-01-06', content: { type: 'doc', content: [] } },
    ]

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/bulk',
      {
        method: 'PUT',
        body: JSON.stringify({ plans }),
      }
    )
    const response = await PUT(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(401)
  })

  it('should return 500 on database error', async () => {
    const mockFrom = vi.fn(() => ({
      upsert: vi.fn(() => ({
        select: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const plans = [
      { date: '2025-01-06', content: { type: 'doc', content: [] } },
    ]

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/bulk',
      {
        method: 'PUT',
        body: JSON.stringify({ plans }),
      }
    )
    const response = await PUT(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(500)
  })
})

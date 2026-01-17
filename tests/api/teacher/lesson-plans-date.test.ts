/**
 * API tests for PUT /api/teacher/classrooms/[id]/lesson-plans/[date]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PUT } from '@/app/api/teacher/classrooms/[id]/lesson-plans/[date]/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherCanMutateClassroom: vi.fn(async () => ({ ok: true })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('PUT /api/teacher/classrooms/[id]/lesson-plans/[date]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 400 for invalid date format', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/invalid-date',
      {
        method: 'PUT',
        body: JSON.stringify({ content: { type: 'doc', content: [] } }),
      }
    )
    const response = await PUT(request, {
      params: Promise.resolve({ id: 'c-1', date: 'invalid-date' }),
    })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('Invalid date format')
  })

  it('should return 400 for missing content', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/2025-01-06',
      {
        method: 'PUT',
        body: JSON.stringify({}),
      }
    )
    const response = await PUT(request, {
      params: Promise.resolve({ id: 'c-1', date: '2025-01-06' }),
    })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('Invalid content format')
  })

  it('should return 400 for invalid content type', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/2025-01-06',
      {
        method: 'PUT',
        body: JSON.stringify({ content: { type: 'invalid', content: [] } }),
      }
    )
    const response = await PUT(request, {
      params: Promise.resolve({ id: 'c-1', date: '2025-01-06' }),
    })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('Invalid content format')
  })

  it('should return 403 when teacher cannot mutate classroom', async () => {
    const { assertTeacherCanMutateClassroom } = await import('@/lib/server/classrooms')
    ;(assertTeacherCanMutateClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/2025-01-06',
      {
        method: 'PUT',
        body: JSON.stringify({ content: { type: 'doc', content: [] } }),
      }
    )
    const response = await PUT(request, {
      params: Promise.resolve({ id: 'c-1', date: '2025-01-06' }),
    })
    expect(response.status).toBe(403)
  })

  it('should upsert lesson plan successfully', async () => {
    const mockLessonPlan = {
      id: 'lp-1',
      classroom_id: 'c-1',
      date: '2025-01-06',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Test' }] }] },
    }

    const mockFrom = vi.fn(() => ({
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: mockLessonPlan, error: null }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/2025-01-06',
      {
        method: 'PUT',
        body: JSON.stringify({ content: mockLessonPlan.content }),
      }
    )
    const response = await PUT(request, {
      params: Promise.resolve({ id: 'c-1', date: '2025-01-06' }),
    })
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.lesson_plan.id).toBe('lp-1')
    expect(data.lesson_plan.date).toBe('2025-01-06')
  })

  it('should return 401 when not authenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    const authError = new Error('Not authenticated')
    authError.name = 'AuthenticationError'
    ;(requireRole as any).mockRejectedValueOnce(authError)

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/2025-01-06',
      {
        method: 'PUT',
        body: JSON.stringify({ content: { type: 'doc', content: [] } }),
      }
    )
    const response = await PUT(request, {
      params: Promise.resolve({ id: 'c-1', date: '2025-01-06' }),
    })
    expect(response.status).toBe(401)
  })

  it('should return 500 on database error', async () => {
    const mockFrom = vi.fn(() => ({
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/2025-01-06',
      {
        method: 'PUT',
        body: JSON.stringify({ content: { type: 'doc', content: [] } }),
      }
    )
    const response = await PUT(request, {
      params: Promise.resolve({ id: 'c-1', date: '2025-01-06' }),
    })
    expect(response.status).toBe(500)
  })
})

/**
 * API tests for PUT /api/teacher/classrooms/[id]/lesson-plans/[date]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST, PUT } from '@/app/api/teacher/classrooms/[id]/lesson-plans/[date]/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherCanMutateClassroom: vi.fn(async () => ({ ok: true })),
}))

const mockSupabaseClient = { from: vi.fn(), rpc: vi.fn() }

describe('PUT /api/teacher/classrooms/[id]/lesson-plans/[date]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies versioned mutations through the atomic ordering function', async () => {
    const mockLessonPlan = {
      id: 'lp-ordered',
      classroom_id: 'c-1',
      date: '2025-01-06',
      content: { type: 'doc', content: [] },
      content_markdown: 'Newest',
    }
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: { applied: true, lesson_plan: mockLessonPlan },
      error: null,
    })

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/2025-01-06',
      {
        method: 'PUT',
        body: JSON.stringify({
          content_markdown: 'Newest',
          mutation: {
            client_id: '10000000-0000-4000-8000-000000000001',
            sequence: 2,
          },
        }),
      },
    )
    const response = await PUT(request, {
      params: Promise.resolve({ id: 'c-1', date: '2025-01-06' }),
    })

    expect(response.status).toBe(200)
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'apply_ordered_lesson_plan_mutation',
      expect.objectContaining({
        p_classroom_id: 'c-1',
        p_client_id: '10000000-0000-4000-8000-000000000001',
        p_date: '2025-01-06',
        p_delete: false,
        p_sequence: 2,
      }),
    )
    expect(await response.json()).toMatchObject({
      applied: true,
      lesson_plan: { id: 'lp-ordered', content_markdown: 'Newest' },
    })
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

  it('should return 400 for an impossible calendar date', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/2026-02-31',
      {
        method: 'PUT',
        body: JSON.stringify({ content_markdown: 'Plan' }),
      },
    )
    const response = await PUT(request, {
      params: Promise.resolve({ id: 'c-1', date: '2026-02-31' }),
    })

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('Invalid date format')
    expect(mockSupabaseClient.rpc).not.toHaveBeenCalled()
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
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
      content_markdown: 'Test',
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
    expect(data.lesson_plan.content_markdown).toBe('Test')
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

  it('deletes the lesson plan when markdown is cleared', async () => {
    const deleteChain = {
      eq: vi.fn().mockReturnThis(),
    }
    deleteChain.eq.mockReturnValueOnce(deleteChain)
    deleteChain.eq.mockResolvedValueOnce({ error: null })

    const mockFrom = vi.fn(() => ({
      delete: vi.fn(() => deleteChain),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest(
      'http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/2025-01-06',
      {
        method: 'PUT',
        body: JSON.stringify({ content_markdown: '' }),
      }
    )
    const response = await PUT(request, {
      params: Promise.resolve({ id: 'c-1', date: '2025-01-06' }),
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.lesson_plan).toBeNull()
    expect(mockFrom).toHaveBeenCalledWith('lesson_plans')
  })

  it('accepts POST requests for unload beacons', async () => {
    const mockLessonPlan = {
      id: 'lp-1',
      classroom_id: 'c-1',
      date: '2025-01-06',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Beacon' }] }] },
      content_markdown: 'Beacon',
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
        method: 'POST',
        body: JSON.stringify({ content_markdown: 'Beacon' }),
      }
    )
    const response = await POST(request, {
      params: Promise.resolve({ id: 'c-1', date: '2025-01-06' }),
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.lesson_plan.content_markdown).toBe('Beacon')
  })
})

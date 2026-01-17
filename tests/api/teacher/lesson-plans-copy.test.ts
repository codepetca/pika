/**
 * API tests for POST /api/teacher/classrooms/[id]/lesson-plans/copy
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/teacher/classrooms/[id]/lesson-plans/copy/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherCanMutateClassroom: vi.fn(async () => ({ ok: true })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/teacher/classrooms/[id]/lesson-plans/copy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 400 when fromDate format is invalid', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/copy', {
      method: 'POST',
      body: JSON.stringify({ fromDate: 'invalid', toDate: '2025-01-15' }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('Invalid date format')
  })

  it('should return 400 when toDate format is invalid', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/copy', {
      method: 'POST',
      body: JSON.stringify({ fromDate: '2025-01-10', toDate: 'bad-date' }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('Invalid date format')
  })

  it('should return 400 when fromDate and toDate are the same', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/copy', {
      method: 'POST',
      body: JSON.stringify({ fromDate: '2025-01-10', toDate: '2025-01-10' }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('must be different')
  })

  it('should return 403 when teacher does not own classroom', async () => {
    const { assertTeacherCanMutateClassroom } = await import('@/lib/server/classrooms')
    ;(assertTeacherCanMutateClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/copy', {
      method: 'POST',
      body: JSON.stringify({ fromDate: '2025-01-10', toDate: '2025-01-15' }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(403)
  })

  it('should return 404 when source lesson plan not found', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
          })),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/copy', {
      method: 'POST',
      body: JSON.stringify({ fromDate: '2025-01-10', toDate: '2025-01-15' }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.error).toContain('Source lesson plan not found')
  })

  it('should successfully copy lesson plan to new date', async () => {
    const sourceContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Test content' }] }] }
    const copiedPlan = {
      id: 'lp-new',
      classroom_id: 'c-1',
      date: '2025-01-15',
      content: sourceContent,
      created_at: '2025-01-10T00:00:00Z',
      updated_at: '2025-01-10T00:00:00Z',
    }

    let selectCallCount = 0
    const mockFrom = vi.fn((table: string) => {
      if (table === 'lesson_plans') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { content: sourceContent },
                  error: null,
                }),
              })),
            })),
          })),
          upsert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: copiedPlan,
                error: null,
              }),
            })),
          })),
        }
      }
      return { select: vi.fn() }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/copy', {
      method: 'POST',
      body: JSON.stringify({ fromDate: '2025-01-10', toDate: '2025-01-15' }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(201)

    const data = await response.json()
    expect(data.lesson_plan).toBeDefined()
    expect(data.lesson_plan.date).toBe('2025-01-15')
    expect(data.lesson_plan.content).toEqual(sourceContent)
  })

  it('should return 401 when not authenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    const authError = new Error('Not authenticated')
    authError.name = 'AuthenticationError'
    ;(requireRole as any).mockRejectedValueOnce(authError)

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/copy', {
      method: 'POST',
      body: JSON.stringify({ fromDate: '2025-01-10', toDate: '2025-01-15' }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(401)
  })

  it('should return 500 when upsert fails', async () => {
    const sourceContent = { type: 'doc', content: [] }

    const mockFrom = vi.fn((table: string) => {
      if (table === 'lesson_plans') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { content: sourceContent },
                  error: null,
                }),
              })),
            })),
          })),
          upsert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Database error' },
              }),
            })),
          })),
        }
      }
      return { select: vi.fn() }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/classrooms/c-1/lesson-plans/copy', {
      method: 'POST',
      body: JSON.stringify({ fromDate: '2025-01-10', toDate: '2025-01-15' }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'c-1' }) })
    expect(response.status).toBe(500)
    const data = await response.json()
    expect(data.error).toContain('Failed to copy')
  })
})

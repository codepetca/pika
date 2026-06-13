/**
 * API tests for GET /api/teacher/class-days
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/teacher/class-days/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => ({ id: 'teacher-1', role: 'teacher' })),
  requireRole: vi.fn(async () => ({ id: 'teacher-1', role: 'teacher' })),
}))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherOwnsClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'c1', teacher_id: 'teacher-1', archived_at: null },
  })),
  assertStudentCanAccessClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'c1', archived_at: null },
  })),
}))
vi.mock('@/lib/calendar', () => ({ getClassDaysForDateRange: vi.fn(() => []) }))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/teacher/class-days', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('should return 400 when classroom_id is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/class-days')
    const response = await GET(request)
    expect(response.status).toBe(400)
  })

  it('should return class days for any authenticated user', async () => {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'class_days') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
          })),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/class-days?classroom_id=c1')
    const response = await GET(request)
    expect(response.status).toBe(200)
  })

  it('blocks teachers from reading class days for classrooms they do not own', async () => {
    const { assertTeacherOwnsClassroom } = await import('@/lib/server/classrooms')
    ;(assertTeacherOwnsClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })
    ;(mockSupabaseClient.from as any) = vi.fn()

    const request = new NextRequest('http://localhost:3000/api/teacher/class-days?classroom_id=c2')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Forbidden')
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })

  it('blocks students from reading class days for classrooms they cannot access', async () => {
    const { requireAuth } = await import('@/lib/auth')
    const { assertStudentCanAccessClassroom } = await import('@/lib/server/classrooms')
    ;(requireAuth as any).mockResolvedValueOnce({ id: 'student-1', role: 'student' })
    ;(assertStudentCanAccessClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Not enrolled in this classroom',
    })
    ;(mockSupabaseClient.from as any) = vi.fn()

    const request = new NextRequest('http://localhost:3000/api/teacher/class-days?classroom_id=c2')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Not enrolled in this classroom')
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })
})

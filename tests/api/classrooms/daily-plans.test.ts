/**
 * API tests for /api/classrooms/[classroomId]/daily-plans
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, PATCH } from '@/app/api/classrooms/[classroomId]/daily-plans/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}))
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherOwnsClassroom: vi.fn(),
  assertTeacherCanMutateClassroom: vi.fn(),
  assertStudentCanAccessClassroom: vi.fn(),
}))
vi.mock('@/lib/week-utils', () => ({
  getWeekStartForDate: vi.fn((date: string) => {
    // Simplified: just return the date if it's already a Monday
    return date
  }),
  getWeekDays: vi.fn((weekStart: string) => {
    // Return Mon-Fri for the week
    const [year, month, day] = weekStart.split('-').map(Number)
    const dates: string[] = []
    for (let i = 0; i < 5; i++) {
      const d = new Date(year, month - 1, day + i)
      dates.push(d.toISOString().split('T')[0])
    }
    return dates
  }),
  getCurrentWeekStart: vi.fn(() => '2026-01-12'),
  canStudentViewWeek: vi.fn(() => true),
}))

import { requireAuth, requireRole } from '@/lib/auth'
import {
  assertTeacherOwnsClassroom,
  assertTeacherCanMutateClassroom,
  assertStudentCanAccessClassroom,
} from '@/lib/server/classrooms'
import { canStudentViewWeek } from '@/lib/week-utils'

const mockSupabaseClient = { from: vi.fn() }

describe('/api/classrooms/[classroomId]/daily-plans', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET', () => {
    it('returns 400 when week_start is missing', async () => {
      vi.mocked(requireAuth).mockResolvedValue({ id: 'teacher-1', email: 'teacher@test.com', role: 'teacher' })
      vi.mocked(assertTeacherOwnsClassroom).mockResolvedValue({
        ok: true,
        classroom: { id: 'classroom-1', teacher_id: 'teacher-1', archived_at: null },
      })

      const request = new NextRequest('http://localhost:3000/api/classrooms/classroom-1/daily-plans')
      const response = await GET(request, { params: Promise.resolve({ classroomId: 'classroom-1' }) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('week_start query parameter is required')
    })

    it('returns 400 when week_start format is invalid', async () => {
      vi.mocked(requireAuth).mockResolvedValue({ id: 'teacher-1', email: 'teacher@test.com', role: 'teacher' })
      vi.mocked(assertTeacherOwnsClassroom).mockResolvedValue({
        ok: true,
        classroom: { id: 'classroom-1', teacher_id: 'teacher-1', archived_at: null },
      })

      const request = new NextRequest('http://localhost:3000/api/classrooms/classroom-1/daily-plans?week_start=01-12-2026')
      const response = await GET(request, { params: Promise.resolve({ classroomId: 'classroom-1' }) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid week_start format (use YYYY-MM-DD)')
    })

    it('returns plans for teacher', async () => {
      vi.mocked(requireAuth).mockResolvedValue({ id: 'teacher-1', email: 'teacher@test.com', role: 'teacher' })
      vi.mocked(assertTeacherOwnsClassroom).mockResolvedValue({
        ok: true,
        classroom: { id: 'classroom-1', teacher_id: 'teacher-1', archived_at: null },
      })

      const mockFrom = vi.fn((table: string) => {
        if (table === 'classrooms') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { future_plans_visibility: 'current' },
                  error: null,
                }),
              })),
            })),
          }
        }
        if (table === 'daily_plans') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({
                  data: [
                    { id: 'plan-1', classroom_id: 'classroom-1', date: '2026-01-12', rich_content: { type: 'doc', content: [] } },
                  ],
                  error: null,
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/classrooms/classroom-1/daily-plans?week_start=2026-01-12')
      const response = await GET(request, { params: Promise.resolve({ classroomId: 'classroom-1' }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.week_start).toBe('2026-01-12')
      expect(data.visibility).toBe('current')
      expect(data.plans['2026-01-12']).toBeDefined()
    })

    it('returns 403 for student when week is not visible', async () => {
      vi.mocked(requireAuth).mockResolvedValue({ id: 'student-1', email: 'student@test.com', role: 'student' })
      vi.mocked(assertStudentCanAccessClassroom).mockResolvedValue({
        ok: true,
        classroom: { id: 'classroom-1', archived_at: null },
      })
      vi.mocked(canStudentViewWeek).mockReturnValue(false)

      const mockFrom = vi.fn((table: string) => {
        if (table === 'classrooms') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { future_plans_visibility: 'current' },
                  error: null,
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/classrooms/classroom-1/daily-plans?week_start=2026-01-19')
      const response = await GET(request, { params: Promise.resolve({ classroomId: 'classroom-1' }) })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('Week not visible to students')
    })

    it('returns plans for student when week is visible', async () => {
      vi.mocked(requireAuth).mockResolvedValue({ id: 'student-1', email: 'student@test.com', role: 'student' })
      vi.mocked(assertStudentCanAccessClassroom).mockResolvedValue({
        ok: true,
        classroom: { id: 'classroom-1', archived_at: null },
      })
      vi.mocked(canStudentViewWeek).mockReturnValue(true)

      const mockFrom = vi.fn((table: string) => {
        if (table === 'classrooms') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { future_plans_visibility: 'current' },
                  error: null,
                }),
              })),
            })),
          }
        }
        if (table === 'daily_plans') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/classrooms/classroom-1/daily-plans?week_start=2026-01-12')
      const response = await GET(request, { params: Promise.resolve({ classroomId: 'classroom-1' }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.plans).toBeDefined()
    })
  })

  describe('PATCH', () => {
    it('returns 400 when date is missing for plan upsert', async () => {
      vi.mocked(requireRole).mockResolvedValue({ id: 'teacher-1', email: 'teacher@test.com', role: 'teacher' })
      vi.mocked(assertTeacherCanMutateClassroom).mockResolvedValue({
        ok: true,
        classroom: { id: 'classroom-1', teacher_id: 'teacher-1', archived_at: null },
      })

      const request = new NextRequest('http://localhost:3000/api/classrooms/classroom-1/daily-plans', {
        method: 'PATCH',
        body: JSON.stringify({ rich_content: { type: 'doc', content: [] } }),
      })
      const response = await PATCH(request, { params: Promise.resolve({ classroomId: 'classroom-1' }) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('date is required')
    })

    it('returns 400 when rich_content is missing', async () => {
      vi.mocked(requireRole).mockResolvedValue({ id: 'teacher-1', email: 'teacher@test.com', role: 'teacher' })
      vi.mocked(assertTeacherCanMutateClassroom).mockResolvedValue({
        ok: true,
        classroom: { id: 'classroom-1', teacher_id: 'teacher-1', archived_at: null },
      })

      const request = new NextRequest('http://localhost:3000/api/classrooms/classroom-1/daily-plans', {
        method: 'PATCH',
        body: JSON.stringify({ date: '2026-01-12' }),
      })
      const response = await PATCH(request, { params: Promise.resolve({ classroomId: 'classroom-1' }) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('rich_content is required and must be an object')
    })

    it('creates a new plan when none exists', async () => {
      vi.mocked(requireRole).mockResolvedValue({ id: 'teacher-1', email: 'teacher@test.com', role: 'teacher' })
      vi.mocked(assertTeacherCanMutateClassroom).mockResolvedValue({
        ok: true,
        classroom: { id: 'classroom-1', teacher_id: 'teacher-1', archived_at: null },
      })

      const mockFrom = vi.fn((table: string) => {
        if (table === 'daily_plans') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'plan-1',
                    classroom_id: 'classroom-1',
                    date: '2026-01-12',
                    rich_content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] },
                    created_at: '2026-01-12T10:00:00Z',
                    updated_at: '2026-01-12T10:00:00Z',
                  },
                  error: null,
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/classrooms/classroom-1/daily-plans', {
        method: 'PATCH',
        body: JSON.stringify({
          date: '2026-01-12',
          rich_content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] },
        }),
      })
      const response = await PATCH(request, { params: Promise.resolve({ classroomId: 'classroom-1' }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.plan.id).toBe('plan-1')
      expect(data.plan.date).toBe('2026-01-12')
    })

    it('updates visibility setting', async () => {
      vi.mocked(requireRole).mockResolvedValue({ id: 'teacher-1', email: 'teacher@test.com', role: 'teacher' })
      vi.mocked(assertTeacherCanMutateClassroom).mockResolvedValue({
        ok: true,
        classroom: { id: 'classroom-1', teacher_id: 'teacher-1', archived_at: null },
      })

      const mockFrom = vi.fn((table: string) => {
        if (table === 'classrooms') {
          return {
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/classrooms/classroom-1/daily-plans', {
        method: 'PATCH',
        body: JSON.stringify({ visibility: 'next' }),
      })
      const response = await PATCH(request, { params: Promise.resolve({ classroomId: 'classroom-1' }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.visibility).toBe('next')
    })

    it('returns 403 when classroom is archived', async () => {
      vi.mocked(requireRole).mockResolvedValue({ id: 'teacher-1', email: 'teacher@test.com', role: 'teacher' })
      vi.mocked(assertTeacherCanMutateClassroom).mockResolvedValue({
        ok: false,
        status: 403,
        error: 'Classroom is archived',
      })

      const request = new NextRequest('http://localhost:3000/api/classrooms/classroom-1/daily-plans', {
        method: 'PATCH',
        body: JSON.stringify({
          date: '2026-01-12',
          rich_content: { type: 'doc', content: [] },
        }),
      })
      const response = await PATCH(request, { params: Promise.resolve({ classroomId: 'classroom-1' }) })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('Classroom is archived')
    })
  })
})

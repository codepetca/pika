/**
 * API tests for GET /api/teacher/attendance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/teacher/attendance/route'
import { NextRequest } from 'next/server'
import { mockAuthenticationError } from '../setup'

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async (role: string) => {
    if (role === 'teacher') {
      return { id: 'teacher-1', email: 'test@teacher.com', role: 'teacher' }
    }
    throw new Error('Unauthorized')
  }),
  AuthenticationError: class AuthenticationError extends Error {
    constructor(message = 'Not authenticated') { super(message); this.name = 'AuthenticationError' }
  },
  AuthorizationError: class AuthorizationError extends Error {
    constructor(message = 'Forbidden') { super(message); this.name = 'AuthorizationError' }
  },
}))

vi.mock('@/lib/attendance', () => ({
  computeAttendanceRecords: vi.fn(() => []),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/teacher/attendance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.from = vi.fn()
  })

  it('should return 401 when not authenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    ;(requireRole as any).mockRejectedValueOnce(mockAuthenticationError())

    const request = new NextRequest('http://localhost:3000/api/teacher/attendance?classroom_id=classroom-1')
    const response = await GET(request)
    expect(response.status).toBe(401)
  })

  it('should return 400 when classroom_id is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/attendance')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('classroom_id is required')
  })

  it('should return 403 when teacher does not own classroom', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { teacher_id: 'other-teacher' },
            error: null,
          }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/attendance?classroom_id=classroom-1')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Forbidden')
  })

  it('should return 404 when classroom does not exist', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: 'PGRST116' },
          }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/attendance?classroom_id=classroom-999')
    const response = await GET(request)
    expect(response.status).toBe(404)
  })

  it('returns attendance records and sorted class-day dates for an owned classroom', async () => {
    const { computeAttendanceRecords } = await import('@/lib/attendance')
    ;(computeAttendanceRecords as any).mockReturnValueOnce([
      {
        student_id: 'student-1',
        student_email: 'a@example.com',
        summary: { present: 1, absent: 0 },
        dates: { '2026-04-20': 'present' },
      },
    ])

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: { teacher_id: 'teacher-1' }, error: null }),
            })),
          })),
        }
      }

      if (table === 'class_days') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({
                data: [
                  { date: '2026-04-20', is_class_day: true },
                  { date: '2026-04-21', is_class_day: false },
                  { date: '2026-04-22', is_class_day: true },
                ],
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [
                { student_id: 'student-2', users: { id: 'student-2', email: 'b@example.com' } },
                { student_id: 'student-1', users: { id: 'student-1', email: 'a@example.com' } },
              ],
              error: null,
            }),
          })),
        }
      }

      if (table === 'student_profiles') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [{ user_id: 'student-1', first_name: 'Ada', last_name: 'Lovelace' }],
              error: null,
            }),
          })),
        }
      }

      if (table === 'entries') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [{ id: 'entry-1' }], error: null }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/attendance?classroom_id=classroom-1')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      attendance: [
        {
          student_id: 'student-1',
          student_email: 'a@example.com',
          summary: { present: 1, absent: 0 },
          dates: { '2026-04-20': 'present' },
        },
      ],
      dates: ['2026-04-20', '2026-04-22'],
      classroom_id: 'classroom-1',
    })
    expect(computeAttendanceRecords).toHaveBeenCalledWith(
      [
        { id: 'student-1', email: 'a@example.com', first_name: 'Ada', last_name: 'Lovelace' },
        { id: 'student-2', email: 'b@example.com', first_name: '', last_name: '' },
      ],
      [
        { date: '2026-04-20', is_class_day: true },
        { date: '2026-04-21', is_class_day: false },
        { date: '2026-04-22', is_class_day: true },
      ],
      [{ id: 'entry-1' }],
      expect.any(String),
    )
  })
})

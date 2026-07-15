/**
 * API tests for GET /api/teacher/attendance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/teacher/attendance/route'
import { NextRequest } from 'next/server'
import { mockAuthenticationError } from '../setup'
import { createPagedQueryLog, mockPagedTable } from '../../support/paged-supabase'

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
        return mockPagedTable([
          { date: '2026-04-20', is_class_day: true },
          { date: '2026-04-21', is_class_day: false },
          { date: '2026-04-22', is_class_day: true },
        ])
      }

      if (table === 'classroom_enrollments') {
        return mockPagedTable([
          { id: 'enrollment-2', student_id: 'student-2', users: { id: 'student-2', email: 'b@example.com' } },
          { id: 'enrollment-1', student_id: 'student-1', users: { id: 'student-1', email: 'a@example.com' } },
        ])
      }

      if (table === 'student_profiles') {
        return mockPagedTable([{ id: 'profile-1', user_id: 'student-1', first_name: 'Ada', last_name: 'Lovelace' }])
      }

      if (table === 'entries') {
        return mockPagedTable([{ id: 'entry-1' }])
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

  it('paginates enrollment rows so large rosters are not truncated', async () => {
    const { computeAttendanceRecords } = await import('@/lib/attendance')
    ;(computeAttendanceRecords as any).mockReturnValueOnce([])
    const log = createPagedQueryLog()
    const enrollments = Array.from({ length: 1001 }, (_, index) => {
      const ordinal = index + 1
      const studentId = `student-${ordinal.toString().padStart(4, '0')}`
      return {
        id: `enrollment-${ordinal.toString().padStart(4, '0')}`,
        classroom_id: 'classroom-1',
        student_id: studentId,
        users: { id: studentId, email: `student-${ordinal.toString().padStart(4, '0')}@example.com` },
      }
    })

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
      if (table === 'class_days') return mockPagedTable([], { table, log })
      if (table === 'classroom_enrollments') return mockPagedTable(enrollments, { table, log })
      if (table === 'student_profiles') return mockPagedTable([], { table, log })
      if (table === 'entries') return mockPagedTable([], { table, log })
      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/attendance?classroom_id=classroom-1')
    const response = await GET(request)

    expect(response.status).toBe(200)
    const studentsArg = (computeAttendanceRecords as any).mock.calls[0][0]
    expect(studentsArg).toHaveLength(1001)
    expect(studentsArg.at(-1)).toMatchObject({
      id: 'student-1001',
      email: 'student-1001@example.com',
    })
    expect(log.rangeCalls).toContainEqual({ table: 'classroom_enrollments', from: 0, to: 999 })
    expect(log.rangeCalls).toContainEqual({ table: 'classroom_enrollments', from: 1000, to: 1999 })
  })

  it('chunks profile and entry reads and paginates dense entry chunks', async () => {
    const { computeAttendanceRecords } = await import('@/lib/attendance')
    ;(computeAttendanceRecords as any).mockReturnValueOnce([])
    const log = createPagedQueryLog()
    const studentIds = Array.from({ length: 51 }, (_, index) => `student-${index + 1}`)
    const enrollments = studentIds.map((studentId, index) => ({
      id: `enrollment-${index + 1}`,
      classroom_id: 'classroom-1',
      student_id: studentId,
      users: { id: studentId, email: `${studentId}@example.com` },
    }))
    const entries = studentIds.flatMap((studentId) =>
      Array.from({ length: 21 }, (_, index) => ({
        id: `entry-${studentId}-${index + 1}`,
        classroom_id: 'classroom-1',
        student_id: studentId,
        date: `2026-04-${(index + 1).toString().padStart(2, '0')}`,
        text: 'present',
      }))
    )

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
      if (table === 'class_days') return mockPagedTable([], { table, log })
      if (table === 'classroom_enrollments') return mockPagedTable(enrollments, { table, log })
      if (table === 'student_profiles') return mockPagedTable([], { table, log })
      if (table === 'entries') return mockPagedTable(entries, { table, log })
      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/attendance?classroom_id=classroom-1')
    const response = await GET(request)

    expect(response.status).toBe(200)
    const entriesArg = (computeAttendanceRecords as any).mock.calls[0][2]
    expect(entriesArg).toHaveLength(1071)

    for (const table of ['student_profiles', 'entries']) {
      const studentChunks = log.inCalls.filter((call) =>
        call.table === table && (call.column === 'user_id' || call.column === 'student_id')
      )
      expect(studentChunks.map((call) => call.values.length)).toContain(50)
      expect(studentChunks.map((call) => call.values.length)).toContain(1)
    }
    expect(log.rangeCalls).toContainEqual({ table: 'entries', from: 0, to: 999 })
    expect(log.rangeCalls).toContainEqual({ table: 'entries', from: 1000, to: 1999 })
  })

  it('returns 500 when student profile hydration fails', async () => {
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
      if (table === 'class_days') return mockPagedTable([])
      if (table === 'classroom_enrollments') {
        return mockPagedTable([
          { id: 'enrollment-1', classroom_id: 'classroom-1', student_id: 'student-1', users: { id: 'student-1', email: 'a@example.com' } },
        ])
      }
      if (table === 'student_profiles') {
        return mockPagedTable([], { error: { message: 'profiles failed' } })
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/attendance?classroom_id=classroom-1')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to fetch student profiles' })
  })
})

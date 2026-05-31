/**
 * API tests for GET /api/teacher/export-csv
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/teacher/export-csv/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/attendance', () => ({ computeAttendanceRecords: vi.fn(() => []) }))
vi.mock('@/lib/timezone', () => ({ getTodayInToronto: vi.fn(() => '2026-04-25') }))

const mockSupabaseClient = { from: vi.fn() }

type QueryLog = {
  inCalls: Array<{ table: string; column: string; values: string[] }>
  orderCalls: Array<{ table: string; column: string }>
  rangeCalls: Array<{ table: string; from: number; to: number }>
}

function createQueryLog(): QueryLog {
  return { inCalls: [], orderCalls: [], rangeCalls: [] }
}

function mockPagedTable(
  rows: Array<Record<string, any>>,
  options: {
    table?: string
    log?: QueryLog
    error?: any
  } = {},
) {
  return {
    select: vi.fn(() => {
      const filters: Array<{ column: string; values: string[] }> = []
      const query: any = {
        in: vi.fn((column: string, values: string[]) => {
          filters.push({ column, values })
          if (options.table) {
            options.log?.inCalls.push({ table: options.table, column, values })
          }
          return query
        }),
        order: vi.fn((column: string) => {
          if (options.table) {
            options.log?.orderCalls.push({ table: options.table, column })
          }
          return query
        }),
        range: vi.fn((from: number, to: number) => {
          if (options.table) {
            options.log?.rangeCalls.push({ table: options.table, from, to })
          }
          if (options.error) {
            return Promise.resolve({ data: null, error: options.error })
          }

          const filteredRows = rows.filter((row) =>
            filters.every((filter) => {
              if (!(filter.column in row)) return true
              return filter.values.includes(String(row[filter.column]))
            })
          )

          return Promise.resolve({
            data: filteredRows.slice(from, to + 1),
            error: null,
          })
        }),
      }
      return query
    }),
  }
}

describe('GET /api/teacher/export-csv', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.from = vi.fn()
  })

  it('should return 400 when classroom_id is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/export-csv')
    const response = await GET(request)
    expect(response.status).toBe(400)
  })

  it('should return 403 when teacher does not own classroom', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { teacher_id: 'other' }, error: null }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/export-csv?classroom_id=c1')
    const response = await GET(request)
    expect(response.status).toBe(403)
  })

  it('returns a CSV export with class-day columns and attendance symbols', async () => {
    const { computeAttendanceRecords } = await import('@/lib/attendance')
    ;(computeAttendanceRecords as any).mockReturnValueOnce([
      {
        student_id: 'student-2',
        student_email: 'b@example.com',
        summary: { present: 1, absent: 1 },
        dates: {
          '2026-04-20': 'present',
          '2026-04-21': 'absent',
        },
      },
      {
        student_id: 'student-1',
        student_email: 'a@example.com',
        summary: { present: 2, absent: 0 },
        dates: {
          '2026-04-20': 'present',
          '2026-04-21': 'present',
        },
      },
    ])

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { teacher_id: 'teacher-1', title: 'Period 1' },
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'class_days') {
        return mockPagedTable([
          { date: '2026-04-20', is_class_day: true },
          { date: '2026-04-21', is_class_day: true },
          { date: '2026-04-22', is_class_day: false },
        ])
      }

      if (table === 'classroom_enrollments') {
        return mockPagedTable([
          { id: 'enrollment-2', student_id: 'student-2', users: { id: 'student-2', email: 'b@example.com' } },
          { id: 'enrollment-1', student_id: 'student-1', users: { id: 'student-1', email: 'a@example.com' } },
        ])
      }

      if (table === 'student_profiles') {
        return mockPagedTable([
          { id: 'profile-1', user_id: 'student-1', first_name: 'Ada', last_name: 'Lovelace' },
          { id: 'profile-2', user_id: 'student-2', first_name: 'Grace', last_name: 'Hopper' },
        ])
      }

      if (table === 'entries') {
        return mockPagedTable([{ id: 'entry-1' }])
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/export-csv?classroom_id=c1')
    const response = await GET(request)
    const csv = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/csv')
    expect(response.headers.get('Content-Disposition')).toMatch(/^attachment; filename="attendance-Period-1-/)
    expect(csv).toBe([
      'Student Email,Present,Absent,2026-04-20,2026-04-21',
      'b@example.com,1,1,P,A',
      'a@example.com,2,0,P,P',
      '',
    ].join('\n'))
    expect(computeAttendanceRecords).toHaveBeenCalledWith(
      [
        { id: 'student-1', email: 'a@example.com', first_name: 'Ada', last_name: 'Lovelace' },
        { id: 'student-2', email: 'b@example.com', first_name: 'Grace', last_name: 'Hopper' },
      ],
      [
        { date: '2026-04-20', is_class_day: true },
        { date: '2026-04-21', is_class_day: true },
        { date: '2026-04-22', is_class_day: false },
      ],
      [{ id: 'entry-1' }],
      '2026-04-25',
    )
  })

  it('paginates large rosters before computing the CSV export', async () => {
    const { computeAttendanceRecords } = await import('@/lib/attendance')
    ;(computeAttendanceRecords as any).mockReturnValueOnce([])
    const log = createQueryLog()
    const enrollments = Array.from({ length: 1001 }, (_, index) => {
      const ordinal = index + 1
      const padded = ordinal.toString().padStart(4, '0')
      const studentId = `student-${padded}`
      return {
        id: `enrollment-${padded}`,
        classroom_id: 'c1',
        student_id: studentId,
        users: { id: studentId, email: `${studentId}@example.com` },
      }
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { teacher_id: 'teacher-1', title: 'Period 1' },
                error: null,
              }),
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

    const request = new NextRequest('http://localhost:3000/api/teacher/export-csv?classroom_id=c1')
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

  it('scopes and paginates dense entry reads for enrolled students', async () => {
    const { computeAttendanceRecords } = await import('@/lib/attendance')
    ;(computeAttendanceRecords as any).mockReturnValueOnce([])
    const log = createQueryLog()
    const studentIds = Array.from({ length: 51 }, (_, index) => `student-${index + 1}`)
    const enrollments = studentIds.map((studentId, index) => ({
      id: `enrollment-${index + 1}`,
      classroom_id: 'c1',
      student_id: studentId,
      users: { id: studentId, email: `${studentId}@example.com` },
    }))
    const entries = [
      ...studentIds.flatMap((studentId) =>
        Array.from({ length: 21 }, (_, index) => ({
          id: `entry-${studentId}-${index + 1}`,
          classroom_id: 'c1',
          student_id: studentId,
          date: `2026-04-${(index + 1).toString().padStart(2, '0')}`,
          text: 'present',
        }))
      ),
      {
        id: 'stale-entry',
        classroom_id: 'c1',
        student_id: 'withdrawn-student',
        date: '2026-04-01',
        text: 'stale',
      },
    ]

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { teacher_id: 'teacher-1', title: 'Period 1' },
                error: null,
              }),
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

    const request = new NextRequest('http://localhost:3000/api/teacher/export-csv?classroom_id=c1')
    const response = await GET(request)

    expect(response.status).toBe(200)
    const entriesArg = (computeAttendanceRecords as any).mock.calls[0][2]
    expect(entriesArg).toHaveLength(1071)
    expect(entriesArg.some((entry: any) => entry.id === 'stale-entry')).toBe(false)
    const entryStudentChunks = log.inCalls
      .filter((call) => call.table === 'entries' && call.column === 'student_id')
      .map((call) => call.values.length)
    expect(entryStudentChunks).toContain(50)
    expect(entryStudentChunks).toContain(1)
    expect(entryStudentChunks.every((length) => length <= 50)).toBe(true)
    expect(log.rangeCalls).toContainEqual({ table: 'entries', from: 0, to: 999 })
    expect(log.rangeCalls).toContainEqual({ table: 'entries', from: 1000, to: 1999 })
  })

  it('returns 500 when student profile hydration fails', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { teacher_id: 'teacher-1', title: 'Period 1' },
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'class_days') return mockPagedTable([])
      if (table === 'classroom_enrollments') {
        return mockPagedTable([
          { id: 'enrollment-1', classroom_id: 'c1', student_id: 'student-1', users: { id: 'student-1', email: 'a@example.com' } },
        ])
      }
      if (table === 'student_profiles') {
        return mockPagedTable([], { error: { message: 'profiles failed' } })
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/export-csv?classroom_id=c1')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Failed to fetch student profiles' })
  })
})

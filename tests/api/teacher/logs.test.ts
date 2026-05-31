/**
 * API tests for GET /api/teacher/logs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GET } from '@/app/api/teacher/logs/route'
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
}))

const mockSupabaseClient = { from: vi.fn(), rpc: vi.fn() }

type QueryLog = {
  eqCalls: Array<{ table: string; column: string; value: string }>
  inCalls: Array<{ table: string; column: string; values: string[] }>
  orderCalls: Array<{ table: string; column: string }>
  rangeCalls: Array<{ table: string; from: number; to: number }>
  limitCalls: Array<{ table: string; count: number }>
}

function createQueryLog(): QueryLog {
  return { eqCalls: [], inCalls: [], orderCalls: [], rangeCalls: [], limitCalls: [] }
}

function mockClassroomQuery(teacherId: string | null, error: any = null) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: teacherId ? { teacher_id: teacherId } : null,
          error,
        }),
      })),
    })),
  }
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
      const filteredRows = () => rows.filter((row) =>
        filters.every((filter) => {
          if (!(filter.column in row)) return true
          return filter.values.includes(String(row[filter.column]))
        })
      )
      const resolveRows = (from: number, to: number) => {
        if (options.error) {
          return Promise.resolve({ data: null, error: options.error })
        }
        return Promise.resolve({
          data: filteredRows().slice(from, to + 1),
          error: null,
        })
      }
      const query: any = {
        eq: vi.fn((column: string, value: string) => {
          filters.push({ column, values: [String(value)] })
          if (options.table) {
            options.log?.eqCalls.push({ table: options.table, column, value: String(value) })
          }
          return query
        }),
        in: vi.fn((column: string, values: string[]) => {
          filters.push({ column, values: values.map(String) })
          if (options.table) {
            options.log?.inCalls.push({ table: options.table, column, values: values.map(String) })
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
          return resolveRows(from, to)
        }),
        limit: vi.fn((count: number) => {
          if (options.table) {
            options.log?.limitCalls.push({ table: options.table, count })
          }
          return resolveRows(0, count - 1)
        }),
      }
      return query
    }),
  }
}

function mockOwnedTeacherTables(
  tables: Record<string, Array<Record<string, any>>>,
  options: {
    log?: QueryLog
    errors?: Record<string, any>
  } = {},
) {
  return vi.fn((table: string) => {
    if (table === 'classrooms') return mockClassroomQuery('teacher-1')
    if (table in tables) {
      return mockPagedTable(tables[table], {
        table,
        log: options.log,
        error: options.errors?.[table],
      })
    }
    throw new Error(`Unexpected table: ${table}`)
  })
}

describe('GET /api/teacher/logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.from = vi.fn()
    mockSupabaseClient.rpc = vi.fn()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('should return 401 when not authenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    ;(requireRole as any).mockRejectedValueOnce(mockAuthenticationError())

    const request = new NextRequest('http://localhost:3000/api/teacher/logs?classroom_id=classroom-1')
    const response = await GET(request)
    expect(response.status).toBe(401)
  })

  it('should return 400 when classroom_id is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/logs')
    const response = await GET(request)
    expect(response.status).toBe(400)
  })

  it('should return 400 for invalid date', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/logs?classroom_id=classroom-1&date=2025-1-1')
    const response = await GET(request)
    expect(response.status).toBe(400)
  })

  it('should return 403 when teacher does not own classroom', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classrooms') return mockClassroomQuery('other-teacher')
      return {}
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/logs?classroom_id=classroom-1')
    const response = await GET(request)
    expect(response.status).toBe(403)
  })

  it('should return 200 with roster and entry (when present)', async () => {
    ;(mockSupabaseClient.from as any) = mockOwnedTeacherTables({
      classroom_enrollments: [
        { id: 'enrollment-1', classroom_id: 'classroom-1', student_id: 's1', users: { id: 's1', email: 'a@student.com' } },
        { id: 'enrollment-2', classroom_id: 'classroom-1', student_id: 's2', users: { id: 's2', email: 'b@student.com' } },
      ],
      student_profiles: [],
      entries: [
        { id: 'e1', student_id: 's2', classroom_id: 'classroom-1', date: '2025-01-02', text: 'hello', minutes_reported: null, mood: null, created_at: '', updated_at: '', on_time: true },
      ],
    })
    ;(mockSupabaseClient.rpc as any).mockResolvedValue({
      data: [
        { id: 'h1', student_id: 's1', classroom_id: 'classroom-1', date: '2025-01-03', text: 'preview 1', minutes_reported: null, mood: null, created_at: '', updated_at: '2025-01-03T12:00:00Z', on_time: true },
        { id: 'h2', student_id: 's2', classroom_id: 'classroom-1', date: '2025-01-02', text: 'hello', minutes_reported: null, mood: null, created_at: '', updated_at: '2025-01-02T12:00:00Z', on_time: true },
      ],
      error: null,
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/logs?classroom_id=classroom-1&date=2025-01-02')
    const response = await GET(request)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.logs).toHaveLength(2)
    expect(body.logs[0].student_email).toBe('a@student.com')
    expect(body.logs[0].entry).toBe(null)
    expect(body.logs[0].history_preview).toEqual([
      expect.objectContaining({ id: 'h1', student_id: 's1' }),
    ])
    expect(body.logs[1].student_email).toBe('b@student.com')
    expect(body.logs[1].entry?.id).toBe('e1')
    expect(body.logs[1].history_preview).toEqual([
      expect.objectContaining({ id: 'h2', student_id: 's2' }),
    ])
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('get_teacher_log_history_preview', {
      p_classroom_id: 'classroom-1',
      p_student_ids: ['s1', 's2'],
      p_limit: 5,
    })
  })

  it('caps batched history previews to five entries per student', async () => {
    ;(mockSupabaseClient.from as any) = mockOwnedTeacherTables({
      classroom_enrollments: [
        { id: 'enrollment-1', classroom_id: 'classroom-1', student_id: 's1', users: { id: 's1', email: 'a@student.com' } },
      ],
      student_profiles: [],
      entries: [],
    })
    const historyRows = Array.from({ length: 7 }, (_, index) => ({
      id: `h${index + 1}`,
      student_id: 's1',
      classroom_id: 'classroom-1',
      date: `2025-01-${String(10 - index).padStart(2, '0')}`,
      text: `preview ${index + 1}`,
      minutes_reported: null,
      mood: null,
      created_at: '',
      updated_at: `2025-01-${String(10 - index).padStart(2, '0')}T12:00:00Z`,
      on_time: true,
    }))
    ;(mockSupabaseClient.rpc as any).mockResolvedValue({
      data: historyRows,
      error: null,
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/logs?classroom_id=classroom-1&date=2025-01-02')
    const response = await GET(request)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.logs[0].history_preview).toHaveLength(5)
    expect(body.logs[0].history_preview.map((entry: any) => entry.id)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5'])
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('get_teacher_log_history_preview', {
      p_classroom_id: 'classroom-1',
      p_student_ids: ['s1'],
      p_limit: 5,
    })
  })

  it('falls back to per-student capped previews when the preview RPC is unavailable', async () => {
    ;(mockSupabaseClient.from as any) = mockOwnedTeacherTables({
      classroom_enrollments: [
        { id: 'enrollment-1', classroom_id: 'classroom-1', student_id: 's1', users: { id: 's1', email: 'a@student.com' } },
        { id: 'enrollment-2', classroom_id: 'classroom-1', student_id: 's2', users: { id: 's2', email: 'b@student.com' } },
      ],
      student_profiles: [],
      entries: [
        { id: 'fallback-h1', student_id: 's1', classroom_id: 'classroom-1', date: '2025-01-03', text: 'fallback 1', minutes_reported: null, mood: null, created_at: '', updated_at: '2025-01-03T12:00:00Z', on_time: true },
        { id: 'fallback-h2', student_id: 's2', classroom_id: 'classroom-1', date: '2025-01-04', text: 'fallback 2', minutes_reported: null, mood: null, created_at: '', updated_at: '2025-01-04T12:00:00Z', on_time: true },
      ],
    })
    ;(mockSupabaseClient.rpc as any).mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'missing function' },
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const request = new NextRequest('http://localhost:3000/api/teacher/logs?classroom_id=classroom-1&date=2025-01-02')
    const response = await GET(request)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.logs[0].history_preview).toEqual([
      expect.objectContaining({ id: 'fallback-h1', student_id: 's1' }),
    ])
    expect(body.logs[1].history_preview).toEqual([
      expect.objectContaining({ id: 'fallback-h2', student_id: 's2' }),
    ])
    expect(warnSpy).toHaveBeenCalledWith(
      'History preview RPC is unavailable; falling back to per-student preview queries'
    )
    warnSpy.mockRestore()
  })

  it('paginates roster rows and chunks history preview RPC calls for large rosters', async () => {
    const log = createQueryLog()
    const enrollments = Array.from({ length: 1001 }, (_, index) => {
      const ordinal = index + 1
      const padded = ordinal.toString().padStart(4, '0')
      const studentId = `student-${padded}`
      return {
        id: `enrollment-${padded}`,
        classroom_id: 'classroom-1',
        student_id: studentId,
        users: { id: studentId, email: `${studentId}@example.com` },
      }
    })
    ;(mockSupabaseClient.from as any) = mockOwnedTeacherTables({
      classroom_enrollments: enrollments,
      student_profiles: [],
      entries: [],
    }, { log })
    ;(mockSupabaseClient.rpc as any).mockResolvedValue({ data: [], error: null })

    const request = new NextRequest('http://localhost:3000/api/teacher/logs?classroom_id=classroom-1')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.logs).toHaveLength(1001)
    expect(body.logs.at(-1)).toMatchObject({
      student_id: 'student-1001',
      student_email: 'student-1001@example.com',
    })
    expect(log.rangeCalls).toContainEqual({ table: 'classroom_enrollments', from: 0, to: 999 })
    expect(log.rangeCalls).toContainEqual({ table: 'classroom_enrollments', from: 1000, to: 1999 })
    const rpcChunks = (mockSupabaseClient.rpc as any).mock.calls.map((call: any[]) => call[1].p_student_ids)
    expect(rpcChunks).toHaveLength(21)
    expect(rpcChunks.every((chunk: string[]) => chunk.length <= 50)).toBe(true)
    expect(rpcChunks.at(-1)).toEqual(['student-1001'])
  })

  it('chunks profile and selected-day entry reads and excludes stale entries', async () => {
    const log = createQueryLog()
    const studentIds = Array.from({ length: 51 }, (_, index) => `student-${index + 1}`)
    const enrollments = studentIds.map((studentId, index) => ({
      id: `enrollment-${index + 1}`,
      classroom_id: 'classroom-1',
      student_id: studentId,
      users: { id: studentId, email: `${studentId}@example.com` },
    }))
    const entries = [
      ...studentIds.flatMap((studentId) =>
        Array.from({ length: 21 }, (_, index) => ({
          id: `entry-${studentId}-${index + 1}`,
          classroom_id: 'classroom-1',
          student_id: studentId,
          date: '2025-01-02',
          text: 'present',
        }))
      ),
      {
        id: 'stale-entry',
        classroom_id: 'classroom-1',
        student_id: 'withdrawn-student',
        date: '2025-01-02',
        text: 'stale',
      },
    ]
    ;(mockSupabaseClient.from as any) = mockOwnedTeacherTables({
      classroom_enrollments: enrollments,
      student_profiles: [],
      entries,
    }, { log })
    ;(mockSupabaseClient.rpc as any).mockResolvedValue({ data: [], error: null })

    const request = new NextRequest('http://localhost:3000/api/teacher/logs?classroom_id=classroom-1&date=2025-01-02')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.logs).toHaveLength(51)
    expect(body.logs.some((row: any) => row.entry?.id === 'stale-entry')).toBe(false)

    for (const table of ['student_profiles', 'entries']) {
      const studentChunks = log.inCalls.filter((call) =>
        call.table === table && (call.column === 'user_id' || call.column === 'student_id')
      )
      expect(studentChunks.map((call) => call.values.length)).toContain(50)
      expect(studentChunks.map((call) => call.values.length)).toContain(1)
      expect(studentChunks.every((call) => call.values.length <= 50)).toBe(true)
    }
    expect(log.rangeCalls).toContainEqual({ table: 'entries', from: 0, to: 999 })
    expect(log.rangeCalls).toContainEqual({ table: 'entries', from: 1000, to: 1999 })
  })

  it('returns 500 when enrollment rows fail to load', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(mockSupabaseClient.from as any) = mockOwnedTeacherTables({
      classroom_enrollments: [],
      student_profiles: [],
      entries: [],
    }, { errors: { classroom_enrollments: { message: 'enrollments failed' } } })

    const request = new NextRequest('http://localhost:3000/api/teacher/logs?classroom_id=classroom-1&date=2025-01-02')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Failed to fetch students' })
    errorSpy.mockRestore()
  })

  it('returns 500 when student profile hydration fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(mockSupabaseClient.from as any) = mockOwnedTeacherTables({
      classroom_enrollments: [
        { id: 'enrollment-1', classroom_id: 'classroom-1', student_id: 'student-1', users: { id: 'student-1', email: 'a@example.com' } },
      ],
      student_profiles: [],
      entries: [],
    }, { errors: { student_profiles: { message: 'profiles failed' } } })

    const request = new NextRequest('http://localhost:3000/api/teacher/logs?classroom_id=classroom-1&date=2025-01-02')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Failed to fetch student profiles' })
    errorSpy.mockRestore()
  })
})

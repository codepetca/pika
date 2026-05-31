/**
 * API tests for GET /api/student/notifications
 * Tests student notification state for sidebar indicators
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/student/notifications/route'
import { NextRequest } from 'next/server'
import { mockAuthenticationError, mockAuthorizationError } from '../setup'

// Mock modules
vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async (role: string) => {
    if (role === 'student') {
      return { id: 'student-1', email: 'test@student.com', role: 'student' }
    }
    throw new Error('Unauthorized')
  }),
}))

vi.mock('@/lib/timezone', () => ({
  getTodayInToronto: vi.fn(() => '2024-10-15'),
}))

vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'classroom-1', archived_at: null },
  })),
}))

const mockSupabaseClient = { from: vi.fn() }

type QueryLog = {
  inCalls: Array<{ table: string; column: string; values: string[] }>
  rangeCalls: Array<{ table: string; from: number; to: number }>
}

function createQueryLog(): QueryLog {
  return { inCalls: [], rangeCalls: [] }
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
          if (!(filter.column in row)) return false
          return filter.values.includes(String(row[filter.column]))
        })
      )
      const resolveRows = (from: number, to: number) => {
        if (options.error) return Promise.resolve({ data: null, error: options.error })
        return Promise.resolve({ data: filteredRows().slice(from, to + 1), error: null })
      }
      const query: any = {
        eq: vi.fn((column: string, value: string | boolean) => {
          filters.push({ column, values: [String(value)] })
          return query
        }),
        in: vi.fn((column: string, values: string[]) => {
          filters.push({ column, values: values.map(String) })
          if (options.table) {
            options.log?.inCalls.push({ table: options.table, column, values: values.map(String) })
          }
          return query
        }),
        or: vi.fn(() => query),
        order: vi.fn(() => query),
        range: vi.fn((from: number, to: number) => {
          if (options.table) options.log?.rangeCalls.push({ table: options.table, from, to })
          return resolveRows(from, to)
        }),
        then: vi.fn((resolve: any, reject: any) => resolveRows(0, rows.length - 1).then(resolve, reject)),
      }
      return query
    }),
  }
}

// Helper to create a mock that handles multiple tables
function createTableMock(config: {
  class_days?: { data: any; error: any }
  entries?: { data: any; error: any }
  assignments?: { data: any; error: any }
  assignment_docs?: { data: any; error: any }
  quizzes?: { data: any; error: any }
  quiz_responses?: { data: any; error: any }
  tests?: { data: any; error: any }
  test_attempts?: { data: any; error: any }
  test_responses?: { data: any; error: any }
  test_student_availability?: { data: any; error: any }
  announcements?: { data: any; error: any }
  announcement_reads?: { data: any; error: any }
}) {
  // Default announcements to empty array if not specified
  const testsConfig = config.tests ?? { data: [], error: null }
  const testAttemptsConfig = config.test_attempts ?? { data: [], error: null }
  const testResponsesConfig = config.test_responses ?? { data: [], error: null }
  const testStudentAvailabilityConfig = config.test_student_availability ?? { data: [], error: null }
  const announcementsConfig = config.announcements ?? { data: [], error: null }
  const announcementReadsConfig = config.announcement_reads ?? { data: [], error: null }

  return vi.fn((table: string) => {
    if (table === 'class_days' && config.class_days) {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue(config.class_days),
        })),
      }
    }
    if (table === 'entries' && config.entries) {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue(config.entries),
        })),
      }
    }
    if (table === 'assignments' && config.assignments) {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          then: vi.fn((resolve: any) => resolve(config.assignments)),
        })),
      }
    }
    if (table === 'assignment_docs' && config.assignment_docs) {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          then: vi.fn((resolve: any) => resolve(config.assignment_docs)),
        })),
      }
    }
    if (table === 'quizzes' && config.quizzes) {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          then: vi.fn((resolve: any) => resolve(config.quizzes)),
        })),
      }
    }
    if (table === 'quiz_responses' && config.quiz_responses) {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          then: vi.fn((resolve: any) => resolve(config.quiz_responses)),
        })),
      }
    }
    if (table === 'tests') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          then: vi.fn((resolve: any) => resolve(testsConfig)),
        })),
      }
    }
    if (table === 'test_responses') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          then: vi.fn((resolve: any) => resolve(testResponsesConfig)),
        })),
      }
    }
    if (table === 'test_attempts') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          then: vi.fn((resolve: any) => resolve(testAttemptsConfig)),
        })),
      }
    }
    if (table === 'test_student_availability') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          then: vi.fn((resolve: any) => resolve(testStudentAvailabilityConfig)),
        })),
      }
    }
    if (table === 'announcements') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          then: vi.fn((resolve: any) => resolve(announcementsConfig)),
        })),
      }
    }
    if (table === 'announcement_reads') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          then: vi.fn((resolve: any) => resolve(announcementReadsConfig)),
        })),
      }
    }
  })
}

describe('GET /api/student/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('authorization', () => {
    it('should return 401 when user is not authenticated', async () => {
      const { requireRole } = await import('@/lib/auth')
      ;(requireRole as any).mockRejectedValueOnce(mockAuthenticationError())

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 403 when student is not enrolled in classroom', async () => {
      const { assertStudentCanAccessClassroom } = await import('@/lib/server/classrooms')
      ;(assertStudentCanAccessClassroom as any).mockResolvedValueOnce({
        ok: false,
        status: 403,
        error: 'Not enrolled in this classroom',
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-999'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('Not enrolled in this classroom')
    })
  })

  describe('validation', () => {
    it('should return 400 when classroom_id is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/student/notifications')

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('classroom_id is required')
    })
  })

  describe('notification state', () => {
    it('should return hasTodayEntry: true when entry exists for today', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: { is_class_day: true }, error: null },
        entries: { data: { id: 'entry-1' }, error: null },
        assignments: { data: [], error: null  },
        quizzes: { data: [], error: null },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.hasTodayEntry).toBe(true)
    })

    it('should return hasTodayEntry: false when no entry exists on a class day', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: { is_class_day: true }, error: null },
        entries: { data: null, error: null },
        assignments: { data: [], error: null },
        quizzes: { data: [], error: null },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.hasTodayEntry).toBe(false)
    })

    it('should return hasTodayEntry: true on non-class days (no entry required)', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: { is_class_day: false }, error: null },
        assignments: { data: [], error: null },
        quizzes: { data: [], error: null },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.hasTodayEntry).toBe(true) // No pulse on non-class days
    })

    it('should return hasTodayEntry: true when no class_days record exists', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: null, error: null }, // No record for today
        assignments: { data: [], error: null },
        quizzes: { data: [], error: null },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.hasTodayEntry).toBe(true) // No pulse when day not defined
    })

    it('should count unviewed assignments (no doc exists)', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: { is_class_day: true }, error: null },
        entries: { data: { id: 'entry-1' }, error: null },
        assignments: { data: [{ id: 'assignment-1' }, { id: 'assignment-2' }], error: null },
        assignment_docs: { data: [], error: null }, // No docs exist
        quizzes: { data: [], error: null },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.unviewedAssignmentsCount).toBe(2)
    })

    it('should count unviewed assignments (doc exists but viewed_at is null)', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: { is_class_day: true }, error: null },
        entries: { data: { id: 'entry-1' }, error: null },
        assignments: { data: [{ id: 'assignment-1' }, { id: 'assignment-2' }], error: null },
        assignment_docs: {
          data: [
            { assignment_id: 'assignment-1', viewed_at: null },
            { assignment_id: 'assignment-2', viewed_at: '2024-10-14T10:00:00Z' },
          ],
          error: null,
        },
        quizzes: { data: [], error: null },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.unviewedAssignmentsCount).toBe(1)
    })

    it('should return 0 unviewed when all assignments are viewed', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: { is_class_day: true }, error: null },
        entries: { data: { id: 'entry-1' }, error: null },
        assignments: { data: [{ id: 'assignment-1' }, { id: 'assignment-2' }], error: null },
        assignment_docs: {
          data: [
            { assignment_id: 'assignment-1', viewed_at: '2024-10-14T10:00:00Z' },
            { assignment_id: 'assignment-2', viewed_at: '2024-10-13T08:00:00Z' },
          ],
          error: null,
        },
        quizzes: { data: [], error: null },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.unviewedAssignmentsCount).toBe(0)
    })

    it('should count viewed assignments when returned feedback is newer than the last view', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: { is_class_day: true }, error: null },
        entries: { data: { id: 'entry-1' }, error: null },
        assignments: { data: [{ id: 'assignment-1' }, { id: 'assignment-2' }], error: null },
        assignment_docs: {
          data: [
            {
              assignment_id: 'assignment-1',
              viewed_at: '2026-01-01T00:00:00.000Z',
              returned_at: null,
              feedback_returned_at: '2026-01-02T00:00:00.000Z',
            },
            {
              assignment_id: 'assignment-2',
              viewed_at: '2026-01-03T00:00:00.000Z',
              returned_at: '2026-01-02T00:00:00.000Z',
              feedback_returned_at: '2026-01-02T00:00:00.000Z',
            },
          ],
          error: null,
        },
        quizzes: { data: [], error: null },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.unviewedAssignmentsCount).toBe(1)
    })

    it('should handle empty assignments list', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: { is_class_day: true }, error: null },
        entries: { data: null, error: null },
        assignments: { data: [], error: null },
        quizzes: { data: [], error: null },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.hasTodayEntry).toBe(false)
      expect(data.unviewedAssignmentsCount).toBe(0)
    })

    it('should page visible assignments and chunk assignment document reads', async () => {
      const assignments = Array.from({ length: 1001 }, (_, index) => ({
        id: `assignment-${index}`,
        classroom_id: 'classroom-1',
        is_draft: false,
        released_at: null,
      }))
      const docs = [
        {
          assignment_id: 'assignment-0',
          student_id: 'student-1',
          viewed_at: '2026-01-01T00:00:00.000Z',
        },
        {
          assignment_id: 'assignment-1',
          student_id: 'student-1',
          viewed_at: null,
        },
        {
          assignment_id: 'assignment-stale',
          student_id: 'student-1',
          viewed_at: '2026-01-01T00:00:00.000Z',
        },
        {
          assignment_id: 'assignment-2',
          student_id: 'student-2',
          viewed_at: '2026-01-01T00:00:00.000Z',
        },
      ]
      const log = createQueryLog()

      ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
        if (table === 'class_days') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: { is_class_day: true }, error: null }),
            })),
          }
        }
        if (table === 'entries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'entry-1' }, error: null }),
            })),
          }
        }
        if (table === 'assignments') return mockPagedTable(assignments, { table, log })
        if (table === 'assignment_docs') return mockPagedTable(docs, { table, log })
        if (table === 'tests') return mockPagedTable([], { table, log })
        if (table === 'announcements') return mockPagedTable([], { table, log })

        throw new Error(`Unexpected table: ${table}`)
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.unviewedAssignmentsCount).toBe(1000)
      expect(log.rangeCalls.filter((call) => call.table === 'assignments')).toEqual([
        { table: 'assignments', from: 0, to: 999 },
        { table: 'assignments', from: 1000, to: 1999 },
      ])
      const assignmentDocChunks = log.inCalls.filter((call) => call.table === 'assignment_docs')
      expect(assignmentDocChunks).toHaveLength(21)
      expect(assignmentDocChunks[0].values).toHaveLength(50)
      expect(assignmentDocChunks[20].values).toHaveLength(1)
    })
  })

  describe('error handling', () => {
    it('should return 500 when class_days query fails', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: null, error: { message: 'Database error' } },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to check notifications')
    })

    it('should return 500 when entries query fails', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: { is_class_day: true }, error: null },
        entries: { data: null, error: { message: 'Database error' } },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to check notifications')
    })

    it('should return 500 when assignments query fails', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: { is_class_day: true }, error: null },
        entries: { data: { id: 'entry-1' }, error: null },
        assignments: { data: null, error: { message: 'Database error' } },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to check notifications')
    })

    it('should return 500 when assignment_docs query fails', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: { is_class_day: true }, error: null },
        entries: { data: { id: 'entry-1' }, error: null },
        assignments: { data: [{ id: 'assignment-1' }], error: null },
        assignment_docs: { data: null, error: { message: 'Database error' } },
        quizzes: { data: [], error: null },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to check notifications')
    })

    it('should return 500 when tests query fails (non-migration error)', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: { is_class_day: true }, error: null },
        entries: { data: { id: 'entry-1' }, error: null },
        assignments: { data: [], error: null },
        quizzes: { data: [], error: null },
        tests: { data: null, error: { code: 'XX000', message: 'Database error' } },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to check notifications')
    })

    it('should return 500 when test response loading fails', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: { is_class_day: true }, error: null },
        entries: { data: { id: 'entry-1' }, error: null },
        assignments: { data: [], error: null },
        tests: { data: [{ id: 'test-1', status: 'active' }], error: null },
        test_responses: { data: null, error: { code: 'XX000', message: 'Database error' } },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to check notifications')
    })

    it('should return 500 when test attempt loading fails', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: { is_class_day: true }, error: null },
        entries: { data: { id: 'entry-1' }, error: null },
        assignments: { data: [], error: null },
        tests: { data: [{ id: 'test-1', status: 'active' }], error: null },
        test_responses: { data: [], error: null },
        test_attempts: { data: null, error: { code: 'XX000', message: 'Database error' } },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to check notifications')
    })

    it('should return 500 when selected test access loading fails', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: { is_class_day: true }, error: null },
        entries: { data: { id: 'entry-1' }, error: null },
        assignments: { data: [], error: null },
        tests: { data: [{ id: 'test-1', status: 'active' }], error: null },
        test_responses: { data: [], error: null },
        test_attempts: { data: [], error: null },
        test_student_availability: { data: null, error: { code: 'XX000', message: 'Database error' } },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to check notifications')
    })

    it('should return 500 when announcements query fails', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: { is_class_day: true }, error: null },
        entries: { data: { id: 'entry-1' }, error: null },
        assignments: { data: [], error: null },
        tests: { data: [], error: null },
        announcements: { data: null, error: { message: 'Database error' } },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to check notifications')
    })

    it('should return 500 when announcement read loading fails', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: { is_class_day: true }, error: null },
        entries: { data: { id: 'entry-1' }, error: null },
        assignments: { data: [], error: null },
        tests: { data: [], error: null },
        announcements: { data: [{ id: 'announcement-1' }], error: null },
        announcement_reads: { data: null, error: { message: 'Database error' } },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to check notifications')
    })
  })

  describe('active tests count', () => {
    it('should count active tests with no student response', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: { is_class_day: true }, error: null },
        entries: { data: { id: 'entry-1' }, error: null },
        assignments: { data: [], error: null },
        quizzes: { data: [], error: null },
        tests: { data: [{ id: 'test-1' }, { id: 'test-2' }], error: null },
        test_responses: { data: [], error: null },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.activeTestsCount).toBe(2)
    })

    it('should return 0 for tests when migration table is missing', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: { is_class_day: true }, error: null },
        entries: { data: { id: 'entry-1' }, error: null },
        assignments: { data: [], error: null },
        quizzes: { data: [{ id: 'quiz-1' }], error: null },
        quiz_responses: { data: [], error: null },
        tests: { data: null, error: { code: 'PGRST205', message: 'table not found' } },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.activeQuizzesCount).toBeUndefined()
      expect(data.activeTestsCount).toBe(0)
    })

    it('should exclude tests the student has responded to', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: { is_class_day: true }, error: null },
        entries: { data: { id: 'entry-1' }, error: null },
        assignments: { data: [], error: null },
        quizzes: { data: [], error: null },
        tests: { data: [{ id: 'test-1' }, { id: 'test-2' }, { id: 'test-3' }], error: null },
        test_responses: {
          data: [{ test_id: 'test-2', selected_option: 0, response_text: null }],
          error: null,
        },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.activeTestsCount).toBe(2)
    })

    it('should exclude active tests closed for this student', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: { is_class_day: true }, error: null },
        entries: { data: { id: 'entry-1' }, error: null },
        assignments: { data: [], error: null },
        quizzes: { data: [], error: null },
        tests: { data: [{ id: 'test-1', status: 'active' }, { id: 'test-2', status: 'active' }], error: null },
        test_responses: { data: [], error: null },
        test_student_availability: {
          data: [{ test_id: 'test-1', state: 'closed' }],
          error: null,
        },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.activeTestsCount).toBe(1)
    })

    it('should count closed tests reopened for this student', async () => {
      const log = createQueryLog()
      const baseFrom = createTableMock({
        class_days: { data: { is_class_day: true }, error: null },
        entries: { data: { id: 'entry-1' }, error: null },
        assignments: { data: [], error: null },
        quizzes: { data: [], error: null },
      })

      ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
        if (table === 'tests') {
          return mockPagedTable(
            [{ id: 'test-1', classroom_id: 'classroom-1', status: 'closed' }],
            { table, log }
          )
        }
        if (table === 'test_responses') return mockPagedTable([], { table, log })
        if (table === 'test_attempts') return mockPagedTable([], { table, log })
        if (table === 'test_student_availability') {
          return mockPagedTable(
            [{ test_id: 'test-1', student_id: 'student-1', state: 'open' }],
            { table, log }
          )
        }
        return baseFrom(table)
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.activeTestsCount).toBe(1)
      expect(log.inCalls).toContainEqual({
        table: 'tests',
        column: 'status',
        values: ['active', 'closed'],
      })
    })

    it('should exclude active tests closed for grading', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: { is_class_day: true }, error: null },
        entries: { data: { id: 'entry-1' }, error: null },
        assignments: { data: [], error: null },
        quizzes: { data: [], error: null },
        tests: { data: [{ id: 'test-1', status: 'active' }], error: null },
        test_responses: { data: [], error: null },
        test_attempts: {
          data: [{
            test_id: 'test-1',
            is_submitted: false,
            closed_for_grading_at: '2026-05-27T12:00:00.000Z',
          }],
          error: null,
        },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.activeTestsCount).toBe(0)
    })

    it('should ignore placeholder graded test rows when counting unanswered tests', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: { is_class_day: true }, error: null },
        entries: { data: { id: 'entry-1' }, error: null },
        assignments: { data: [], error: null },
        quizzes: { data: [], error: null },
        tests: { data: [{ id: 'test-1' }, { id: 'test-2' }], error: null },
        test_responses: {
          data: [{ test_id: 'test-1', selected_option: null, response_text: '   ' }],
          error: null,
        },
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.activeTestsCount).toBe(2)
    })

    it('should page active tests and chunk response, attempt, and availability reads', async () => {
      const tests = Array.from({ length: 1001 }, (_, index) => ({
        id: `test-${index}`,
        classroom_id: 'classroom-1',
        status: 'active',
      }))
      const testResponses = [
        {
          test_id: 'test-0',
          student_id: 'student-1',
          selected_option: 0,
          response_text: null,
        },
        {
          test_id: 'test-stale',
          student_id: 'student-1',
          selected_option: 0,
          response_text: null,
        },
        {
          test_id: 'test-3',
          student_id: 'student-2',
          selected_option: 0,
          response_text: null,
        },
      ]
      const testAttempts = [
        {
          test_id: 'test-1',
          student_id: 'student-1',
          is_submitted: true,
          closed_for_grading_at: null,
        },
        {
          test_id: 'test-4',
          student_id: 'student-2',
          is_submitted: true,
          closed_for_grading_at: null,
        },
      ]
      const availabilityRows = [
        {
          test_id: 'test-2',
          student_id: 'student-1',
          state: 'closed',
        },
        {
          test_id: 'test-5',
          student_id: 'student-2',
          state: 'closed',
        },
      ]
      const log = createQueryLog()

      ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
        if (table === 'class_days') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: { is_class_day: true }, error: null }),
            })),
          }
        }
        if (table === 'entries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'entry-1' }, error: null }),
            })),
          }
        }
        if (table === 'assignments') return mockPagedTable([], { table, log })
        if (table === 'tests') return mockPagedTable(tests, { table, log })
        if (table === 'test_responses') return mockPagedTable(testResponses, { table, log })
        if (table === 'test_attempts') return mockPagedTable(testAttempts, { table, log })
        if (table === 'test_student_availability') {
          return mockPagedTable(availabilityRows, { table, log })
        }
        if (table === 'announcements') return mockPagedTable([], { table, log })

        throw new Error(`Unexpected table: ${table}`)
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.activeTestsCount).toBe(998)
      expect(log.rangeCalls.filter((call) => call.table === 'tests')).toEqual([
        { table: 'tests', from: 0, to: 999 },
        { table: 'tests', from: 1000, to: 1999 },
      ])
      for (const table of ['test_responses', 'test_attempts', 'test_student_availability']) {
        const chunks = log.inCalls.filter((call) => call.table === table)
        expect(chunks).toHaveLength(21)
        expect(chunks[0].values).toHaveLength(50)
        expect(chunks[20].values).toHaveLength(1)
      }
    })
  })

  describe('announcement counts', () => {
    it('should page announcements and chunk announcement read filters', async () => {
      const announcements = Array.from({ length: 1001 }, (_, index) => ({
        id: `announcement-${index}`,
        classroom_id: 'classroom-1',
      }))
      const reads = [
        {
          announcement_id: 'announcement-0',
          user_id: 'student-1',
        },
        {
          announcement_id: 'announcement-stale',
          user_id: 'student-1',
        },
        {
          announcement_id: 'announcement-1',
          user_id: 'student-2',
        },
      ]
      const log = createQueryLog()

      ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
        if (table === 'class_days') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: { is_class_day: true }, error: null }),
            })),
          }
        }
        if (table === 'entries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'entry-1' }, error: null }),
            })),
          }
        }
        if (table === 'assignments') return mockPagedTable([], { table, log })
        if (table === 'tests') return mockPagedTable([], { table, log })
        if (table === 'announcements') return mockPagedTable(announcements, { table, log })
        if (table === 'announcement_reads') return mockPagedTable(reads, { table, log })

        throw new Error(`Unexpected table: ${table}`)
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.unreadAnnouncementsCount).toBe(1000)
      expect(log.rangeCalls.filter((call) => call.table === 'announcements')).toEqual([
        { table: 'announcements', from: 0, to: 999 },
        { table: 'announcements', from: 1000, to: 1999 },
      ])
      const readChunks = log.inCalls.filter((call) => call.table === 'announcement_reads')
      expect(readChunks).toHaveLength(21)
      expect(readChunks[0].values).toHaveLength(50)
      expect(readChunks[20].values).toHaveLength(1)
    })
  })
})

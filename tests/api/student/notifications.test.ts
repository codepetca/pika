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

// Helper to create a mock that handles multiple tables
function createTableMock(config: {
  class_days?: { data: any; error: any }
  entries?: { data: any; error: any }
  assignments?: { data: any; error: any }
  assignment_docs?: { data: any; error: any }
}) {
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
        assignments: { data: [], error: null },
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
      })

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.unviewedAssignmentsCount).toBe(0)
    })

    it('should handle empty assignments list', async () => {
      ;(mockSupabaseClient.from as any) = createTableMock({
        class_days: { data: { is_class_day: true }, error: null },
        entries: { data: null, error: null },
        assignments: { data: [], error: null },
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
})

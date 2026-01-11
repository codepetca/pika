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
      const mockFrom = vi.fn((table: string) => {
        if (table === 'entries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'entry-1' },
                error: null,
              }),
            })),
          }
        }
        if (table === 'assignments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              then: vi.fn((resolve: any) =>
                resolve({
                  data: [],
                  error: null,
                })
              ),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.hasTodayEntry).toBe(true)
    })

    it('should return hasTodayEntry: false when no entry exists for today', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'entries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            })),
          }
        }
        if (table === 'assignments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              then: vi.fn((resolve: any) =>
                resolve({
                  data: [],
                  error: null,
                })
              ),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.hasTodayEntry).toBe(false)
    })

    it('should count unviewed assignments (no doc exists)', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'entries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'entry-1' },
                error: null,
              }),
            })),
          }
        }
        if (table === 'assignments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              then: vi.fn((resolve: any) =>
                resolve({
                  data: [
                    { id: 'assignment-1', assignment_docs: [] }, // No doc
                    { id: 'assignment-2', assignment_docs: [] }, // No doc
                  ],
                  error: null,
                })
              ),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.unviewedAssignmentsCount).toBe(2)
    })

    it('should count unviewed assignments (doc exists but viewed_at is null)', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'entries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'entry-1' },
                error: null,
              }),
            })),
          }
        }
        if (table === 'assignments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              then: vi.fn((resolve: any) =>
                resolve({
                  data: [
                    { id: 'assignment-1', assignment_docs: [{ viewed_at: null }] },
                    { id: 'assignment-2', assignment_docs: [{ viewed_at: '2024-10-14T10:00:00Z' }] },
                  ],
                  error: null,
                })
              ),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.unviewedAssignmentsCount).toBe(1)
    })

    it('should return 0 unviewed when all assignments are viewed', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'entries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'entry-1' },
                error: null,
              }),
            })),
          }
        }
        if (table === 'assignments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              then: vi.fn((resolve: any) =>
                resolve({
                  data: [
                    { id: 'assignment-1', assignment_docs: [{ viewed_at: '2024-10-14T10:00:00Z' }] },
                    { id: 'assignment-2', assignment_docs: [{ viewed_at: '2024-10-13T08:00:00Z' }] },
                  ],
                  error: null,
                })
              ),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.unviewedAssignmentsCount).toBe(0)
    })

    it('should handle empty assignments list', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'entries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            })),
          }
        }
        if (table === 'assignments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              then: vi.fn((resolve: any) =>
                resolve({
                  data: [],
                  error: null,
                })
              ),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

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
    it('should return 500 when entries query fails', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'entries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Database error' },
              }),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest(
        'http://localhost:3000/api/student/notifications?classroom_id=classroom-1'
      )

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to check notifications')
    })

    it('should return 500 when assignments query fails', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'entries') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'entry-1' },
                error: null,
              }),
            })),
          }
        }
        if (table === 'assignments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              then: vi.fn((resolve: any) =>
                resolve({
                  data: null,
                  error: { message: 'Database error' },
                })
              ),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

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

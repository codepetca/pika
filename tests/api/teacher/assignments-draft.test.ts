/**
 * API tests for assignment draft mode functionality
 * Tests the release endpoint at /api/teacher/assignments/[id]/release
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/teacher/assignments/[id]/release/route'
import { NextRequest } from 'next/server'
import { mockAuthenticationError } from '../setup'

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async (role: string) => {
    if (role === 'teacher') {
      return { id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' }
    }
    throw new Error('Unauthorized')
  }),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/teacher/assignments/[id]/release', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('authorization', () => {
    it('should return 401 when user is not authenticated', async () => {
      const { requireRole } = await import('@/lib/auth')
      ;(requireRole as any).mockRejectedValueOnce(mockAuthenticationError())

      const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/release', {
        method: 'POST',
      })

      const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 403 when teacher does not own the classroom', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'assignments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'assignment-1',
                    is_draft: true,
                    classrooms: { teacher_id: 'other-teacher', archived_at: null },
                  },
                  error: null,
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/release', {
        method: 'POST',
      })

      const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('Unauthorized')
    })
  })

  describe('validation', () => {
    it('should return 404 when assignment does not exist', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'assignments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'Not found' },
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/teacher/assignments/nonexistent/release', {
        method: 'POST',
      })

      const response = await POST(request, { params: Promise.resolve({ id: 'nonexistent' }) })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Assignment not found')
    })

    it('should return 400 when assignment is already released', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'assignments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'assignment-1',
                    is_draft: false, // Already released
                    released_at: '2024-01-01T00:00:00Z',
                    classrooms: { teacher_id: 'teacher-1', archived_at: null },
                  },
                  error: null,
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/release', {
        method: 'POST',
      })

      const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Assignment is already released')
    })

    it('should return 403 when classroom is archived', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'assignments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'assignment-1',
                    is_draft: true,
                    classrooms: { teacher_id: 'teacher-1', archived_at: '2024-01-01T00:00:00Z' },
                  },
                  error: null,
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/release', {
        method: 'POST',
      })

      const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('Classroom is archived')
    })
  })

  describe('successful release', () => {
    it('should release a draft assignment and return updated assignment', async () => {
      const releasedAssignment = {
        id: 'assignment-1',
        title: 'Essay 1',
        is_draft: false,
        released_at: '2024-01-15T12:00:00Z',
      }

      const mockFrom = vi.fn((table: string) => {
        if (table === 'assignments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'assignment-1',
                    title: 'Essay 1',
                    is_draft: true,
                    classrooms: { teacher_id: 'teacher-1', archived_at: null },
                  },
                  error: null,
                }),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: releasedAssignment,
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/release', {
        method: 'POST',
      })

      const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.assignment).toBeDefined()
      expect(data.assignment.is_draft).toBe(false)
      expect(data.assignment.released_at).toBeDefined()
    })

    it('should set is_draft to false and released_at to current time', async () => {
      let capturedUpdate: any = null

      const mockFrom = vi.fn((table: string) => {
        if (table === 'assignments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'assignment-1',
                    is_draft: true,
                    classrooms: { teacher_id: 'teacher-1', archived_at: null },
                  },
                  error: null,
                }),
              })),
            })),
            update: vi.fn((updateData) => {
              capturedUpdate = updateData
              return {
                eq: vi.fn(() => ({
                  select: vi.fn(() => ({
                    single: vi.fn().mockResolvedValue({
                      data: { id: 'assignment-1', ...updateData },
                      error: null,
                    }),
                  })),
                })),
              }
            }),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/release', {
        method: 'POST',
      })

      await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })

      expect(capturedUpdate).toBeDefined()
      expect(capturedUpdate.is_draft).toBe(false)
      expect(capturedUpdate.released_at).toBeDefined()
    })
  })

  describe('error handling', () => {
    it('should return 500 when update fails', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'assignments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'assignment-1',
                    is_draft: true,
                    classrooms: { teacher_id: 'teacher-1', archived_at: null },
                  },
                  error: null,
                }),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: 'Database error' },
                  }),
                })),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/release', {
        method: 'POST',
      })

      const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to release assignment')
    })
  })
})

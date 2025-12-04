/**
 * API tests for POST /api/student/classrooms/join
 * Tests joining classrooms by code or ID
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/student/classrooms/join/route'
import { NextRequest } from 'next/server'
import { mockAuthenticationError } from '../setup'

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

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/student/classrooms/join', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('authorization', () => {
    it('should return 401 when user is not authenticated', async () => {
      const { requireRole } = await import('@/lib/auth')
      ;(requireRole as any).mockRejectedValueOnce(mockAuthenticationError())

      const request = new NextRequest('http://localhost:3000/api/student/classrooms/join', {
        method: 'POST',
        body: JSON.stringify({ classCode: 'MATH101' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })
  })

  describe('validation', () => {
    it('should return 400 when both classCode and classroomId are missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/student/classrooms/join', {
        method: 'POST',
        body: JSON.stringify({}),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Class code or classroom ID is required')
    })
  })

  describe('joining by class code', () => {
    it('should return 404 when classroom with code does not exist', async () => {
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

      const request = new NextRequest('http://localhost:3000/api/student/classrooms/join', {
        method: 'POST',
        body: JSON.stringify({ classCode: 'INVALID' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Classroom not found')
    })

    it('should enroll student when classroom found by code', async () => {
      const mockInsert = vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { id: 'enrollment-new-1' },
            error: null,
          }),
        })),
      }))

      const mockFrom = vi.fn((table: string) => {
        if (table === 'classrooms') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'classroom-1',
                    title: 'Math 101',
                    class_code: 'MATH101',
                    term_label: 'Fall 2024',
                  },
                  error: null,
                }),
              })),
            })),
          }
        } else if (table === 'classroom_enrollments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            })),
            insert: mockInsert,
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/classrooms/join', {
        method: 'POST',
        body: JSON.stringify({ classCode: 'MATH101' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(201)
      expect(data.success).toBe(true)
      expect(data.classroom.id).toBe('classroom-1')
      expect(mockInsert).toHaveBeenCalledWith({
        classroom_id: 'classroom-1',
        student_id: 'student-1',
      })
    })
  })

  describe('joining by classroom ID', () => {
    it('should find classroom by ID when provided', async () => {
      const mockInsert = vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { id: 'enrollment-new-1' },
            error: null,
          }),
        })),
      }))

      const mockFrom = vi.fn((table: string) => {
        if (table === 'classrooms') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'classroom-1', title: 'Math 101' },
                  error: null,
                }),
              })),
            })),
          }
        } else if (table === 'classroom_enrollments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
            insert: mockInsert,
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/classrooms/join', {
        method: 'POST',
        body: JSON.stringify({ classroomId: 'classroom-1' }),
      })

      const response = await POST(request)

      expect(response.status).toBe(201)
    })
  })

  describe('already enrolled', () => {
    it('should return success when already enrolled', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'classrooms') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'classroom-1', title: 'Math 101' },
                  error: null,
                }),
              })),
            })),
          }
        } else if (table === 'classroom_enrollments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { id: 'enrollment-existing-1' },
                error: null,
              }),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/classrooms/join', {
        method: 'POST',
        body: JSON.stringify({ classCode: 'MATH101' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.alreadyEnrolled).toBe(true)
    })

    it('should not create duplicate enrollment when already enrolled', async () => {
      const mockInsert = vi.fn()
      const mockFrom = vi.fn((table: string) => {
        if (table === 'classrooms') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'classroom-1', title: 'Math 101' },
                  error: null,
                }),
              })),
            })),
          }
        } else if (table === 'classroom_enrollments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { id: 'enrollment-1' },
                error: null,
              }),
            })),
            insert: mockInsert,
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/classrooms/join', {
        method: 'POST',
        body: JSON.stringify({ classCode: 'MATH101' }),
      })

      await POST(request)

      expect(mockInsert).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('should return 500 when enrollment creation fails', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'classrooms') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'classroom-1', title: 'Math 101' },
                  error: null,
                }),
              })),
            })),
          }
        } else if (table === 'classroom_enrollments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'Insert failed' },
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/classrooms/join', {
        method: 'POST',
        body: JSON.stringify({ classCode: 'MATH101' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to join classroom')
    })
  })
})

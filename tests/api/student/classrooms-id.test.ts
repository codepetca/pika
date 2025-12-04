/**
 * API tests for GET /api/student/classrooms/[id]
 * Tests getting classroom details for enrolled students
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/student/classrooms/[id]/route'
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

describe('GET /api/student/classrooms/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('authorization', () => {
    it('should return 401 when user is not authenticated', async () => {
      const { requireRole } = await import('@/lib/auth')
      ;(requireRole as any).mockRejectedValueOnce(mockAuthenticationError())

      const request = new NextRequest('http://localhost:3000/api/student/classrooms/classroom-1')
      const response = await GET(request, { params: { id: 'classroom-1' } })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 403 when student is not enrolled', async () => {
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: 'PGRST116' },
          }),
        })),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/classrooms/classroom-999')
      const response = await GET(request, { params: { id: 'classroom-999' } })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('Not enrolled in this classroom')
    })
  })

  describe('fetching classroom', () => {
    it('should return classroom details when enrolled', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'classroom_enrollments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { id: 'enrollment-1' },
                error: null,
              }),
            })),
          }
        } else if (table === 'classrooms') {
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
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/classrooms/classroom-1')
      const response = await GET(request, { params: { id: 'classroom-1' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.classroom).toMatchObject({
        id: 'classroom-1',
        title: 'Math 101',
        class_code: 'MATH101',
      })
    })

    it('should return 404 when classroom does not exist', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'classroom_enrollments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { id: 'enrollment-1' },
                error: null,
              }),
            })),
          }
        } else if (table === 'classrooms') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST116' },
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/classrooms/classroom-999')
      const response = await GET(request, { params: { id: 'classroom-999' } })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Classroom not found')
    })

    it('should verify enrollment before fetching classroom', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'classroom_enrollments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { id: 'enrollment-1' },
                error: null,
              }),
            })),
          }
        } else if (table === 'classrooms') {
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
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/classrooms/classroom-1')
      await GET(request, { params: { id: 'classroom-1' } })

      // Verify enrollment was checked first
      expect(mockFrom).toHaveBeenCalledWith('classroom_enrollments')
      expect(mockFrom).toHaveBeenCalledWith('classrooms')
    })
  })
})

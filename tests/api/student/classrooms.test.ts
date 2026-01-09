/**
 * API tests for GET /api/student/classrooms
 * Tests listing student's enrolled classrooms
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/student/classrooms/route'
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

describe('GET /api/student/classrooms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('authorization', () => {
    it('should return 401 when user is not authenticated', async () => {
      const { requireRole } = await import('@/lib/auth')
      ;(requireRole as any).mockRejectedValueOnce(mockAuthenticationError())

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })
  })

  describe('fetching classrooms', () => {
    it('should return empty array when no enrollments exist', async () => {
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            })),
          })),
        })),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.classrooms).toEqual([])
    })

    it('should return list of enrolled classrooms', async () => {
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'enrollment-1',
                    created_at: '2024-09-01T10:00:00Z',
                    classrooms: {
                      id: 'classroom-1',
                      title: 'Math 101',
                      class_code: 'MATH101',
                      term_label: 'Fall 2024',
                      updated_at: '2024-09-01T10:00:00Z',
                    },
                  },
                  {
                    id: 'enrollment-2',
                    created_at: '2024-09-02T10:00:00Z',
                    classrooms: {
                      id: 'classroom-2',
                      title: 'Science 101',
                      class_code: 'SCI101',
                      term_label: 'Fall 2024',
                      updated_at: '2024-09-02T10:00:00Z',
                    },
                  },
                ],
                error: null,
              }),
            })),
          })),
        })),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.classrooms).toHaveLength(2)
      expect(data.classrooms[0]).toMatchObject({
        id: 'classroom-1',
        title: 'Math 101',
        enrollmentId: 'enrollment-1',
        enrolledAt: '2024-09-01T10:00:00Z',
      })
    })

    it('should order classrooms by enrollment date descending', async () => {
      const mockOrder = vi.fn().mockResolvedValue({ data: [], error: null })
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(() => ({
              order: mockOrder,
            })),
          })),
        })),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      await GET()

      expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false })
    })

    it('should filter by student_id', async () => {
      const mockEq = vi.fn(() => ({
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      }))
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: mockEq,
        })),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      await GET()

      expect(mockEq).toHaveBeenCalledWith('student_id', 'student-1')
    })

    it('should return 500 when database query fails', async () => {
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database error' },
            }),
          })),
        })),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to fetch classrooms')
    })

    it('should include enrollment metadata in response', async () => {
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'enrollment-1',
                  created_at: '2024-09-01T10:00:00Z',
                  classrooms: {
                    id: 'classroom-1',
                    title: 'Math 101',
                  },
                },
              ],
              error: null,
            }),
          })),
        })),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const response = await GET()
      const data = await response.json()

      expect(data.classrooms[0]).toHaveProperty('enrollmentId', 'enrollment-1')
      expect(data.classrooms[0]).toHaveProperty('enrolledAt', '2024-09-01T10:00:00Z')
    })
  })
})

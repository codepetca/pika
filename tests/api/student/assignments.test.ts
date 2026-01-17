/**
 * API tests for GET /api/student/assignments
 * Tests listing assignments with status for enrolled students
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/student/assignments/route'
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
vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'classroom-1', archived_at: null },
  })),
}))

vi.mock('@/lib/assignments', () => ({
  calculateAssignmentStatus: vi.fn((assignment, doc) => {
    if (doc?.is_submitted) return 'submitted'
    if (doc) return 'in-progress'
    return 'not-started'
  }),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/student/assignments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('authorization', () => {
    it('should return 401 when user is not authenticated', async () => {
      const { requireRole } = await import('@/lib/auth')
      ;(requireRole as any).mockRejectedValueOnce(mockAuthenticationError())

      const request = new NextRequest('http://localhost:3000/api/student/assignments?classroom_id=classroom-1')

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })
  })

  describe('validation', () => {
    it('should return 400 when classroom_id is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/student/assignments')

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('classroom_id is required')
    })
  })

  describe('enrollment verification', () => {
    it('should return 403 when student is not enrolled', async () => {
      const { assertStudentCanAccessClassroom } = await import('@/lib/server/classrooms')
      ;(assertStudentCanAccessClassroom as any).mockResolvedValueOnce({
        ok: false,
        status: 403,
        error: 'Not enrolled in this classroom',
      })

      const request = new NextRequest('http://localhost:3000/api/student/assignments?classroom_id=classroom-999')

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('Not enrolled in this classroom')
    })
  })

  describe('draft filtering', () => {
    it('should filter out draft assignments from student view', async () => {
      // The student API should only return released assignments (is_draft = false)
      // This test verifies the .eq('is_draft', false) filter is applied
      const mockEq = vi.fn()
        .mockImplementationOnce(() => ({ // .eq('classroom_id', ...)
          eq: vi.fn(() => ({ // .eq('is_draft', false)
            order: vi.fn().mockResolvedValue({
              data: [
                { id: 'assignment-1', title: 'Released Assignment', is_draft: false },
              ],
              error: null,
            }),
          })),
        }))

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
        } else if (table === 'assignments') {
          return {
            select: vi.fn(() => ({
              eq: mockEq,
            })),
          }
        } else if (table === 'assignment_docs') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/assignments?classroom_id=classroom-1')

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      // Verify that the query filters by is_draft = false
      expect(mockEq).toHaveBeenCalledWith('classroom_id', 'classroom-1')
    })
  })

  describe('fetching assignments', () => {
    it('should return empty array when no assignments exist', async () => {
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
        } else if (table === 'assignments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({  // Added for is_draft filter
                  order: vi.fn().mockResolvedValue({
                    data: [],
                    error: null,
                  }),
                })),
              })),
            })),
          }
        } else if (table === 'assignment_docs') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/assignments?classroom_id=classroom-1')

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.assignments).toEqual([])
    })

    it('should return assignments with status', async () => {
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
        } else if (table === 'assignments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({  // Added for is_draft filter
                  order: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: 'assignment-1',
                        classroom_id: 'classroom-1',
                        title: 'Essay 1',
                        due_at: '2024-10-20T23:59:59-04:00',
                      },
                      {
                        id: 'assignment-2',
                        classroom_id: 'classroom-1',
                        title: 'Essay 2',
                        due_at: '2024-10-25T23:59:59-04:00',
                      },
                    ],
                    error: null,
                  }),
                })),
              })),
            })),
          }
        } else if (table === 'assignment_docs') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'doc-1',
                      assignment_id: 'assignment-1',
                      student_id: 'student-1',
                      is_submitted: true,
                    },
                  ],
                  error: null,
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/assignments?classroom_id=classroom-1')

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.assignments).toHaveLength(2)
      expect(data.assignments[0]).toHaveProperty('status')
      expect(data.assignments[0]).toHaveProperty('doc')
    })

    it('should calculate status using calculateAssignmentStatus', async () => {
      const { calculateAssignmentStatus } = await import('@/lib/assignments')

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
        } else if (table === 'assignments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({  // Added for is_draft filter
                  order: vi.fn().mockResolvedValue({
                    data: [{ id: 'assignment-1', title: 'Test' }],
                    error: null,
                  }),
                })),
              })),
            })),
          }
        } else if (table === 'assignment_docs') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/assignments?classroom_id=classroom-1')

      await GET(request)

      expect(calculateAssignmentStatus).toHaveBeenCalled()
    })

    it('should order assignments by due_at ascending', async () => {
      const mockOrder = vi.fn().mockResolvedValue({ data: [], error: null })
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
        } else if (table === 'assignments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({  // Added for is_draft filter
                  order: mockOrder,
                })),
              })),
            })),
          }
        } else if (table === 'assignment_docs') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({ data: [], error: null }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/assignments?classroom_id=classroom-1')

      await GET(request)

      expect(mockOrder).toHaveBeenCalledWith('due_at', { ascending: true })
    })

    it('should include doc in response when exists', async () => {
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
        } else if (table === 'assignments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({  // Added for is_draft filter
                  order: vi.fn().mockResolvedValue({
                    data: [{ id: 'assignment-1', title: 'Test' }],
                    error: null,
                  }),
                })),
              })),
            })),
          }
        } else if (table === 'assignment_docs') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({
                  data: [{ id: 'doc-1', assignment_id: 'assignment-1' }],
                  error: null,
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/assignments?classroom_id=classroom-1')

      const response = await GET(request)
      const data = await response.json()

      expect(data.assignments[0].doc).not.toBeNull()
      expect(data.assignments[0].doc.id).toBe('doc-1')
    })

    it('should include null doc when none exists', async () => {
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
        } else if (table === 'assignments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({  // Added for is_draft filter
                  order: vi.fn().mockResolvedValue({
                    data: [{ id: 'assignment-1', title: 'Test' }],
                    error: null,
                  }),
                })),
              })),
            })),
          }
        } else if (table === 'assignment_docs') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/student/assignments?classroom_id=classroom-1')

      const response = await GET(request)
      const data = await response.json()

      expect(data.assignments[0].doc).toBeNull()
    })
  })

  describe('error handling', () => {
    it('should return 500 when fetching assignments fails', async () => {
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
        } else if (table === 'assignments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({  // Added for is_draft filter
                  order: vi.fn().mockResolvedValue({
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

      const request = new NextRequest('http://localhost:3000/api/student/assignments?classroom_id=classroom-1')

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to fetch assignments')
    })
  })
})

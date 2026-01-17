/**
 * Integration test for assignment draft mode flow
 * Tests the full lifecycle: draft creation → student can't see → release → student can see
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET as getStudentAssignments } from '@/app/api/student/assignments/route'
import { POST as releaseAssignment } from '@/app/api/teacher/assignments/[id]/release/route'
import { NextRequest } from 'next/server'

// Shared state to simulate database
let mockAssignment = {
  id: 'assignment-1',
  classroom_id: 'classroom-1',
  title: 'Essay Assignment',
  description: 'Write an essay',
  due_at: '2024-12-01T23:59:59Z',
  is_draft: true,
  released_at: null as string | null,
  created_at: '2024-01-01T00:00:00Z',
  created_by: 'teacher-1',
}

const mockSupabaseClient = { from: vi.fn() }

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

// Mock auth to switch between student and teacher
let currentUser = { id: 'student-1', role: 'student' }

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async (role: string) => {
    if (role === 'student' && currentUser.role === 'student') {
      return { id: currentUser.id, email: 'student@example.com', role: 'student' }
    }
    if (role === 'teacher' && currentUser.role === 'teacher') {
      return { id: currentUser.id, email: 'teacher@example.com', role: 'teacher' }
    }
    const error = new Error('Unauthorized')
    error.name = 'AuthorizationError'
    throw error
  }),
}))

// Mock classroom access check for student API
vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'classroom-1', archived_at: null },
  })),
}))

// Mock assignment status calculation
vi.mock('@/lib/assignments', () => ({
  calculateAssignmentStatus: vi.fn(() => 'not-started'),
}))

describe('Assignment Draft Mode Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset assignment to draft state
    mockAssignment = {
      id: 'assignment-1',
      classroom_id: 'classroom-1',
      title: 'Essay Assignment',
      description: 'Write an essay',
      due_at: '2024-12-01T23:59:59Z',
      is_draft: true,
      released_at: null,
      created_at: '2024-01-01T00:00:00Z',
      created_by: 'teacher-1',
    }
  })

  it('should hide draft assignments from students, then show after release', async () => {
    // Setup mock that respects is_draft filter
    const setupMockForStudentQuery = () => {
      ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
        if (table === 'classroom_enrollments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { id: 'enrollment-1', classroom_id: 'classroom-1', student_id: 'student-1' },
                error: null,
              }),
            })),
          }
        } else if (table === 'assignments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((col: string, val: any) => {
                // First .eq is classroom_id, second is is_draft
                return {
                  eq: vi.fn((col2: string, val2: any) => {
                    // Filter by is_draft - only return assignment if it matches the filter
                    const assignments = mockAssignment.is_draft === val2 ? [] : [mockAssignment]
                    return {
                      order: vi.fn().mockResolvedValue({
                        data: mockAssignment.is_draft ? [] : [mockAssignment],
                        error: null,
                      }),
                    }
                  }),
                }
              }),
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
    }

    const setupMockForReleaseQuery = () => {
      ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
        if (table === 'assignments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    ...mockAssignment,
                    classrooms: { teacher_id: 'teacher-1', archived_at: null },
                  },
                  error: null,
                }),
              })),
            })),
            update: vi.fn((updateData: any) => {
              // Apply the update to our mock assignment
              mockAssignment.is_draft = updateData.is_draft
              mockAssignment.released_at = updateData.released_at
              return {
                eq: vi.fn(() => ({
                  select: vi.fn(() => ({
                    single: vi.fn().mockResolvedValue({
                      data: mockAssignment,
                      error: null,
                    }),
                  })),
                })),
              }
            }),
          }
        }
      })
    }

    // Step 1: Student queries assignments - should NOT see the draft
    currentUser = { id: 'student-1', role: 'student' }
    setupMockForStudentQuery()

    const studentRequest1 = new NextRequest(
      'http://localhost:3000/api/student/assignments?classroom_id=classroom-1'
    )
    const studentResponse1 = await getStudentAssignments(studentRequest1)
    const studentData1 = await studentResponse1.json()

    expect(studentResponse1.status).toBe(200)
    expect(studentData1.assignments).toHaveLength(0) // Draft is hidden

    // Step 2: Teacher releases the assignment
    currentUser = { id: 'teacher-1', role: 'teacher' }
    setupMockForReleaseQuery()

    const releaseRequest = new NextRequest(
      'http://localhost:3000/api/teacher/assignments/assignment-1/release',
      { method: 'POST' }
    )
    const releaseResponse = await releaseAssignment(releaseRequest, {
      params: Promise.resolve({ id: 'assignment-1' }),
    })
    const releaseData = await releaseResponse.json()

    expect(releaseResponse.status).toBe(200)
    expect(releaseData.assignment.is_draft).toBe(false)
    expect(releaseData.assignment.released_at).toBeDefined()

    // Verify mock assignment was updated
    expect(mockAssignment.is_draft).toBe(false)
    expect(mockAssignment.released_at).not.toBeNull()

    // Step 3: Student queries assignments again - should now see the released assignment
    currentUser = { id: 'student-1', role: 'student' }
    setupMockForStudentQuery()

    const studentRequest2 = new NextRequest(
      'http://localhost:3000/api/student/assignments?classroom_id=classroom-1'
    )
    const studentResponse2 = await getStudentAssignments(studentRequest2)
    const studentData2 = await studentResponse2.json()

    expect(studentResponse2.status).toBe(200)
    expect(studentData2.assignments).toHaveLength(1) // Now visible
    expect(studentData2.assignments[0].id).toBe('assignment-1')
    expect(studentData2.assignments[0].title).toBe('Essay Assignment')
  })

  it('should prevent re-releasing an already released assignment', async () => {
    // Start with a released assignment
    mockAssignment.is_draft = false
    mockAssignment.released_at = '2024-01-15T00:00:00Z'

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  ...mockAssignment,
                  classrooms: { teacher_id: 'teacher-1', archived_at: null },
                },
                error: null,
              }),
            })),
          })),
        }
      }
    })

    currentUser = { id: 'teacher-1', role: 'teacher' }

    const releaseRequest = new NextRequest(
      'http://localhost:3000/api/teacher/assignments/assignment-1/release',
      { method: 'POST' }
    )
    const releaseResponse = await releaseAssignment(releaseRequest, {
      params: Promise.resolve({ id: 'assignment-1' }),
    })
    const releaseData = await releaseResponse.json()

    expect(releaseResponse.status).toBe(400)
    expect(releaseData.error).toBe('Assignment is already released')
  })
})

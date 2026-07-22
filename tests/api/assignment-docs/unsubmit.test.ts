/**
 * API tests for POST /api/assignment-docs/[id]/unsubmit
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/assignment-docs/[id]/unsubmit/route'
import { NextRequest } from 'next/server'

const mockUnsubmitAssignmentDocAtomic = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'student-1', role: 'student' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'class-1', archived_at: null },
  })),
}))
vi.mock('@/lib/server/assignment-doc-submissions', () => ({
  unsubmitAssignmentDocAtomic: mockUnsubmitAssignmentDocAtomic,
}))

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/assignment-docs/[id]/unsubmit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUnsubmitAssignmentDocAtomic.mockResolvedValue({
      ok: true,
      doc: {
        id: 'doc-1',
        is_submitted: false,
        content: { type: 'doc', content: [] },
        teacher_feedback_draft: 'Private teacher draft',
        ai_feedback_suggestion: 'Private AI suggestion',
        authenticity_score: 88,
      },
      historyEntry: null,
    })
  })

  it('should return 404 when doc does not exist', async () => {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'assign-1', classroom_id: 'class-1' },
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'enroll-1' },
              error: null,
            }),
          })),
        }
      }
      if (table === 'assignment_docs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
          })),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/unsubmit', {
      method: 'POST',
    })

    const response = await POST(request, { params: { id: 'assign-1' } })
    expect(response.status).toBe(404)
  })

  it('unsubmits when doc exists', async () => {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'assign-1', classroom_id: 'class-1' },
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'enroll-1' },
              error: null,
            }),
          })),
        }
      }
      if (table === 'assignment_docs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'doc-1',
                student_id: 'student-1',
                assignment_id: 'assign-1',
                is_submitted: true,
                submitted_at: '2026-05-01T12:00:00.000Z',
                returned_at: null,
                teacher_cleared_at: null,
              },
              error: null,
            }),
          })),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/unsubmit', {
      method: 'POST',
    })

    const response = await POST(request, { params: { id: 'assign-1' } })
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.doc).toEqual(expect.objectContaining({
      teacher_feedback_draft: null,
      ai_feedback_suggestion: null,
      authenticity_score: null,
    }))
    expect(mockUnsubmitAssignmentDocAtomic).toHaveBeenCalledWith(expect.objectContaining({
      assignmentId: 'assign-1',
      studentId: 'student-1',
    }))
  })

  it('allows unsubmit after a returned assignment has been resubmitted', async () => {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'assign-1', classroom_id: 'class-1' },
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'assignment_docs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'doc-1',
                student_id: 'student-1',
                assignment_id: 'assign-1',
                is_submitted: true,
                submitted_at: '2026-05-02T12:00:00.000Z',
                returned_at: '2026-05-01T12:00:00.000Z',
                teacher_cleared_at: '2026-05-01T12:00:00.000Z',
              },
              error: null,
            }),
          })),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/unsubmit', {
      method: 'POST',
    })

    const response = await POST(request, { params: { id: 'assign-1' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.doc.is_submitted).toBe(false)
    expect(mockUnsubmitAssignmentDocAtomic).toHaveBeenCalledWith(expect.objectContaining({
      assignmentId: 'assign-1',
      studentId: 'student-1',
    }))
  })

  it('rejects when teacher return wins after the route preflight', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'assign-1', classroom_id: 'class-1' },
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'assignment_docs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'doc-1',
                student_id: 'student-1',
                is_submitted: true,
                submitted_at: '2026-05-02T12:00:00.000Z',
                returned_at: null,
                teacher_cleared_at: null,
              },
              error: null,
            }),
          })),
        }
      }
    })
    mockUnsubmitAssignmentDocAtomic.mockResolvedValue({
      ok: false,
      status: 409,
      error: 'Returned submissions cannot be unsubmitted',
      errorCode: 'assignment_doc_returned',
    })

    const response = await POST(new NextRequest(
      'http://localhost:3000/api/assignment-docs/assign-1/unsubmit',
      { method: 'POST' }
    ), { params: { id: 'assign-1' } })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Returned submissions cannot be unsubmitted',
    })
  })
})

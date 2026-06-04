/**
 * API tests for GET/PATCH /api/assignment-docs/[id]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, PATCH } from '@/app/api/assignment-docs/[id]/route'
import { NextRequest } from 'next/server'
import * as auth from '@/lib/auth'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => ({ id: 'student-1', role: 'student' })),
  requireRole: vi.fn(async () => ({ id: 'student-1', role: 'student' })),
}))
vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'class-1', archived_at: null },
  })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/assignment-docs/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(auth.requireAuth).mockResolvedValue({ id: 'student-1', role: 'student' } as any)
  })

  it('should return 404 when assignment does not exist', async () => {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
            })),
          })),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/assignment-docs/assign-999')
    const response = await GET(request, { params: { id: 'assign-999' } })
    expect(response.status).toBe(404)
  })

  it('should create a doc when missing', async () => {
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
      } else if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'enroll-1' },
              error: null,
            }),
          })),
        }
      } else if (table === 'assignment_docs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: 'PGRST116' },
            }),
          })),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'doc-new', assignment_id: 'assign-1', student_id: 'student-1', content: '' },
                error: null,
              }),
            })),
          })),
        }
      } else if (table === 'assignment_feedback_entries') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          })),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/assignment-docs/assign-1')
    const response = await GET(request, { params: { id: 'assign-1' } })
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.doc.id).toBe('doc-new')
  })

  it('refreshes viewed_at when returned feedback is newer than the last view', async () => {
    const viewedUpdate = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }))
    const existingDoc = {
      id: 'doc-1',
      assignment_id: 'assign-1',
      student_id: 'student-1',
      content: { type: 'doc', content: [] },
      viewed_at: '2026-01-01T00:00:00.000Z',
      returned_at: null,
      feedback_returned_at: '2026-01-02T00:00:00.000Z',
    }
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
            single: vi.fn().mockResolvedValue({ data: existingDoc, error: null }),
          })),
          update: viewedUpdate,
        }
      }
      if (table === 'assignment_feedback_entries') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            then: vi.fn((resolve: any) => resolve({ data: [], error: null })),
          })),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/assignment-docs/assign-1')
    const response = await GET(request, { params: { id: 'assign-1' } })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.wasFirstView).toBe(true)
    expect(viewedUpdate).toHaveBeenCalledWith({
      viewed_at: expect.stringMatching(/^20/),
    })
  })

  it('lets the classroom teacher read an enrolled student assignment doc without marking it viewed', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValueOnce({ id: 'teacher-1', role: 'teacher' } as any)
    const viewedUpdate = vi.fn()
    const enrollmentFilters: Array<[string, unknown]> = []
    const docFilters: Array<[string, unknown]> = []
    const existingDoc = {
      id: 'doc-1',
      assignment_id: 'assign-1',
      student_id: 'student-1',
      content: JSON.stringify({ type: 'doc', content: [] }),
      viewed_at: null,
      returned_at: null,
      feedback_returned_at: null,
    }
    const mockFrom = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'assign-1',
                  classroom_id: 'class-1',
                  is_draft: true,
                  classrooms: { id: 'class-1', teacher_id: 'teacher-1' },
                },
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'classroom_enrollments') {
        const enrollmentChain = {
          eq: vi.fn((column: string, value: unknown) => {
            enrollmentFilters.push([column, value])
            return enrollmentChain
          }),
          single: vi.fn().mockResolvedValue({ data: { id: 'enroll-1' }, error: null }),
        }
        return {
          select: vi.fn(() => enrollmentChain),
        }
      }
      if (table === 'assignment_docs') {
        const docChain = {
          eq: vi.fn((column: string, value: unknown) => {
            docFilters.push([column, value])
            return docChain
          }),
          single: vi.fn().mockResolvedValue({ data: existingDoc, error: null }),
        }
        return {
          select: vi.fn(() => docChain),
          update: viewedUpdate,
        }
      }
      if (table === 'assignment_feedback_entries') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            then: vi.fn((resolve: any) => resolve({ data: [], error: null })),
          })),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/assignment-docs/assign-1?student_id=student-1')
    const response = await GET(request, { params: { id: 'assign-1' } })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.doc.id).toBe('doc-1')
    expect(data.doc.content).toEqual({ type: 'doc', content: [] })
    expect(data.wasFirstView).toBe(false)
    expect(viewedUpdate).not.toHaveBeenCalled()
    expect(enrollmentFilters).toEqual([
      ['classroom_id', 'class-1'],
      ['student_id', 'student-1'],
    ])
    expect(docFilters).toEqual([
      ['assignment_id', 'assign-1'],
      ['student_id', 'student-1'],
    ])
  })

  it('requires student_id for teacher reads', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValueOnce({ id: 'teacher-1', role: 'teacher' } as any)
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'assign-1',
                  classroom_id: 'class-1',
                  classrooms: { id: 'class-1', teacher_id: 'teacher-1' },
                },
                error: null,
              }),
            })),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/assignment-docs/assign-1'),
      { params: { id: 'assign-1' } }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('student_id is required')
  })

  it('blocks teacher reads for assignments they do not own', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValueOnce({ id: 'teacher-2', role: 'teacher' } as any)
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'assign-1',
                  classroom_id: 'class-1',
                  classrooms: { id: 'class-1', teacher_id: 'teacher-1' },
                },
                error: null,
              }),
            })),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/assignment-docs/assign-1?student_id=student-1'),
      { params: { id: 'assign-1' } }
    )
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Unauthorized')
  })

  it('blocks teacher reads for students outside the assignment classroom', async () => {
    vi.mocked(auth.requireAuth).mockResolvedValueOnce({ id: 'teacher-1', role: 'teacher' } as any)
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'assign-1',
                  classroom_id: 'class-1',
                  classrooms: { id: 'class-1', teacher_id: 'teacher-1' },
                },
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
            single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/assignment-docs/assign-1?student_id=student-2'),
      { params: { id: 'assign-1' } }
    )
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Not enrolled in this classroom')
  })
})

describe('PATCH /api/assignment-docs/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(auth.requireRole).mockResolvedValue({ id: 'student-1', role: 'student' } as any)
  })

  it('should return 403 when trying to update submitted doc', async () => {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'assignment_docs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'doc-1', student_id: 'student-1', is_submitted: true, assignment_id: 'assign-1' },
              error: null,
            }),
          })),
        }
      } else if (table === 'assignments') {
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
      } else if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'enroll-1' },
              error: null,
            }),
          })),
        }
      } else if (table === 'assignment_feedback_entries') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          })),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/assignment-docs/doc-1', {
      method: 'PATCH',
      body: JSON.stringify({ content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'new content' }] }] } }),
    })

    const response = await PATCH(request, { params: { id: 'doc-1' } })
    expect(response.status).toBe(403)
  })

  it('updates last history entry when rate-limited', async () => {
    const now = new Date('2025-01-01T00:00:05Z').getTime()
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(now)

    const historyUpdate = vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'history-1',
              assignment_doc_id: 'doc-1',
              patch: null,
              snapshot: null,
              word_count: 3,
              char_count: 3,
              trigger: 'autosave',
              created_at: new Date(now).toISOString(),
            },
            error: null,
          }),
        })),
      })),
    }))
    const historyInsert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    }))

    const beforeContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Old' }] }],
    }
    const newContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New' }] }],
    }

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
            single: vi.fn().mockResolvedValue({ data: { id: 'enroll-1' }, error: null }),
          })),
        }
      }
      if (table === 'assignment_docs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'doc-1', student_id: 'student-1', is_submitted: false, content: beforeContent },
              error: null,
            }),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'doc-1', content: newContent },
                  error: null,
                }),
              })),
            })),
          })),
        }
      }
      if (table === 'assignment_doc_history') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn(() => ({
              limit: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'history-1', created_at: new Date(now - 5000).toISOString(), snapshot: null },
                  error: null,
                }),
              })),
            })),
          })),
          update: historyUpdate,
          insert: historyInsert,
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/assignment-docs/assign-1', {
      method: 'PATCH',
      body: JSON.stringify({ content: newContent }),
    })

    const response = await PATCH(request, { params: { id: 'assign-1' } })
    expect(response.status).toBe(200)
    expect(historyUpdate).toHaveBeenCalled()
    expect(historyInsert).not.toHaveBeenCalled()
    dateSpy.mockRestore()
  })

  it('keeps assignment doc content updates student-only', async () => {
    const error = new Error('Forbidden: student role required')
    error.name = 'AuthorizationError'
    vi.mocked(auth.requireRole).mockRejectedValueOnce(error)

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/assignment-docs/assign-1', {
        method: 'PATCH',
        body: JSON.stringify({ content: { type: 'doc', content: [] } }),
      }),
      { params: { id: 'assign-1' } }
    )
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Forbidden')
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })
})

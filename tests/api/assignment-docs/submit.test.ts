/**
 * API tests for POST /api/assignment-docs/[id]/submit
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/assignment-docs/[id]/submit/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'student-1', role: 'student' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'class-1', archived_at: null },
  })),
}))
vi.mock('@/lib/authenticity', () => ({
  analyzeAuthenticity: vi.fn(() => ({ score: 0.82, flags: ['steady_revision'] })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/assignment-docs/[id]/submit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.from = vi.fn()
  })

  it('should return 400 when doc does not exist', async () => {
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

    const request = new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/submit', {
      method: 'POST',
    })

    const response = await POST(request, { params: { id: 'assign-1' } })
    expect(response.status).toBe(400)
  })

  it('should return 400 when doc content is empty', async () => {
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
              data: { id: 'doc-1', student_id: 'student-1', assignment_id: 'assign-1', content: '   ' },
              error: null,
            }),
          })),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/submit', {
      method: 'POST',
    })

    const response = await POST(request, { params: { id: 'assign-1' } })
    expect(response.status).toBe(400)
  })

  it('submits work, records history, and attaches authenticity results', async () => {
    const historyInsert = vi.fn(async () => ({ error: null }))
    const authenticityUpdate = vi.fn(async () => ({ error: null }))
    const submittedContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Finished work' }] }],
    }

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'assign-1', classroom_id: 'class-1', is_draft: false, released_at: null },
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'assignment_docs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'doc-1', student_id: 'student-1', content: submittedContent },
                  error: null,
                }),
              })),
            })),
          })),
          update: vi.fn((payload: Record<string, unknown>) => {
            if ('is_submitted' in payload) {
              return {
                eq: vi.fn(() => ({
                  select: vi.fn(() => ({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        id: 'doc-1',
                        student_id: 'student-1',
                        content: submittedContent,
                        is_submitted: true,
                        submitted_at: payload.submitted_at,
                      },
                      error: null,
                    }),
                  })),
                })),
              }
            }
            return { eq: authenticityUpdate }
          }),
        }
      }

      if (table === 'assignment_doc_history') {
        return {
          insert: historyInsert,
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({
                data: [
                  { id: 'h-1', assignment_doc_id: 'doc-1', word_count: 1, char_count: 4, trigger: 'autosave' },
                  { id: 'h-2', assignment_doc_id: 'doc-1', word_count: 2, char_count: 13, trigger: 'submit' },
                ],
                error: null,
              }),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/submit', {
      method: 'POST',
    })

    const response = await POST(request, { params: { id: 'assign-1' } })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.doc).toEqual(expect.objectContaining({
      id: 'doc-1',
      is_submitted: true,
      authenticity_score: 0.82,
      authenticity_flags: ['steady_revision'],
    }))
    expect(historyInsert).toHaveBeenCalledWith(expect.objectContaining({
      assignment_doc_id: 'doc-1',
      snapshot: submittedContent,
      word_count: 2,
      char_count: 13,
      trigger: 'submit',
    }))
    expect(authenticityUpdate).toHaveBeenCalledWith('id', 'doc-1')
  })

  it('still returns the submitted doc when history or authenticity side effects fail', async () => {
    const submittedContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Finished work' }] }],
    }

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'assign-1', classroom_id: 'class-1', is_draft: false, released_at: null },
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'assignment_docs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'doc-1', student_id: 'student-1', content: submittedContent },
                  error: null,
                }),
              })),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'doc-1',
                    student_id: 'student-1',
                    content: submittedContent,
                    is_submitted: true,
                    submitted_at: '2026-04-25T12:00:00.000Z',
                  },
                  error: null,
                }),
              })),
            })),
          })),
        }
      }

      if (table === 'assignment_doc_history') {
        return {
          insert: vi.fn(async () => {
            throw new Error('history failed')
          }),
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(async () => {
                throw new Error('auth history failed')
              }),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/submit', {
      method: 'POST',
    }), { params: { id: 'assign-1' } })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.doc).toEqual(expect.objectContaining({
      id: 'doc-1',
      is_submitted: true,
    }))
  })
})

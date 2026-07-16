/**
 * API tests for POST /api/assignment-docs/[id]/submit
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/assignment-docs/[id]/submit/route'
import { NextRequest } from 'next/server'
import { submitAssignmentDocAtomic } from '@/lib/server/assignment-doc-submissions'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'student-1', role: 'student' })) }))
vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'class-1', archived_at: null },
  })),
}))
vi.mock('@/lib/authenticity', () => ({
  analyzeAuthenticity: vi.fn(() => ({
    score: 0.82,
    flags: [{
      timestamp: '2026-07-16T12:00:00.000Z',
      wordDelta: 10,
      seconds: 2,
      wps: 5,
      reason: 'high_wps',
    }],
  })),
}))
vi.mock('@/lib/server/assignment-doc-submissions', () => ({
  submitAssignmentDocAtomic: vi.fn(),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/assignment-docs/[id]/submit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.from = vi.fn()
  })

  it('rejects invalid submitted content before reading assignment data', async () => {
    const request = new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: null }),
    })

    const response = await POST(request, { params: { id: 'assign-1' } })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('content: Invalid content format')
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })

  it('rejects malformed nested Tiptap nodes before reading assignment data', async () => {
    const request = new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { type: 'doc', content: [{ type: 'paragraph', content: [null] }] },
        expected_updated_at: '2026-04-20T14:00:00.000Z',
      }),
    })

    const response = await POST(request, { params: { id: 'assign-1' } })
    expect(response.status).toBe(400)
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { type: 'doc', content: [] },
        expected_updated_at: '2026-04-20T14:00:00.000Z',
      }),
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { type: 'doc', content: [] },
        expected_updated_at: '2026-04-20T14:00:00.000Z',
      }),
    })

    const response = await POST(request, { params: { id: 'assign-1' } })
    expect(response.status).toBe(400)
  })

  it('rejects saved repo metadata only because repo links must be in assignment content', async () => {
    const historyInsert = vi.fn(async () => ({ error: null }))
    const emptyContent = { type: 'doc', content: [] }
    const updateDoc = vi.fn((payload: Record<string, unknown>) => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'doc-1',
              student_id: 'student-1',
              content: emptyContent,
              repo_url: 'https://github.com/codepetca/student-work',
              github_username: 'student1',
              is_submitted: true,
              submitted_at: payload.submitted_at,
            },
            error: null,
          }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'assign-1',
                  classroom_id: 'class-1',
                  is_draft: false,
                  released_at: '2026-04-01T12:00:00.000Z',
                  due_at: '2026-04-15T03:59:59.000Z',
                },
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
                  data: {
                    id: 'doc-1',
                    student_id: 'student-1',
                    content: emptyContent,
                    repo_url: 'https://github.com/codepetca/student-work',
                    github_username: 'student1',
                  },
                  error: null,
                }),
              })),
            })),
          })),
          update: updateDoc,
        }
      }

      if (table === 'assignment_doc_history') {
        return {
          insert: historyInsert,
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: emptyContent,
        expected_updated_at: '2026-04-20T14:00:00.000Z',
      }),
    }), { params: { id: 'assign-1' } })

    expect(response.status).toBe(400)
    expect(updateDoc).not.toHaveBeenCalled()
    expect(historyInsert).not.toHaveBeenCalled()
  })

  it('submits work atomically and keeps private authenticity results out of the response', async () => {
    const historyInsert = vi.fn(async () => ({ error: null }))
    const authenticityUpdate = vi.fn(async () => ({ error: null }))
    const savedRevision = '2026-04-20T14:00:00.000Z'
    const submittedRevision = '2026-04-20T14:30:00.000Z'
    const submitFilters: Array<[string, unknown]> = []
    const savedContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Older saved work' }] }],
    }
    const submittedContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Finished work' }] }],
    }
    const submitUpdate = vi.fn()
    vi.mocked(submitAssignmentDocAtomic).mockResolvedValueOnce({
      ok: true,
      doc: {
        id: 'doc-1',
        assignment_id: 'assign-1',
        student_id: 'student-1',
        content: submittedContent,
        is_submitted: true,
        submitted_at: submittedRevision,
        updated_at: submittedRevision,
      } as any,
      historyEntry: {
        id: 'h-2',
        assignment_doc_id: 'doc-1',
        snapshot: submittedContent,
        patch: null,
        word_count: 2,
        char_count: 13,
        trigger: 'submit',
        created_at: submittedRevision,
      } as any,
    })

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
                  data: {
                    id: 'doc-1',
                    student_id: 'student-1',
                    content: savedContent,
                    is_submitted: false,
                    submitted_at: null,
                    updated_at: savedRevision,
                  },
                  error: null,
                }),
              })),
            })),
          })),
          update: vi.fn((payload: Record<string, unknown>) => {
            if ('is_submitted' in payload) {
              submitUpdate(payload)
              const submitChain = {
                eq: vi.fn((column: string, value: unknown) => {
                  submitFilters.push([column, value])
                  return submitChain
                }),
                select: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: 'doc-1',
                      student_id: 'student-1',
                      content: payload.content,
                      is_submitted: true,
                      submitted_at: payload.submitted_at,
                      updated_at: submittedRevision,
                    },
                    error: null,
                  }),
                })),
              }
              return {
                ...submitChain,
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: submittedContent,
        expected_updated_at: savedRevision,
      }),
    })

    const response = await POST(request, { params: { id: 'assign-1' } })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.doc).toEqual(expect.objectContaining({
      id: 'doc-1',
      content: submittedContent,
      is_submitted: true,
      authenticity_score: null,
      authenticity_flags: null,
      teacher_feedback_draft: null,
      ai_feedback_suggestion: null,
    }))
    expect(submitAssignmentDocAtomic).toHaveBeenCalledWith(expect.objectContaining({
      assignmentId: 'assign-1',
      studentId: 'student-1',
      content: submittedContent,
      expectedUpdatedAt: savedRevision,
    }))
    expect(historyInsert).not.toHaveBeenCalled()
    expect(submitUpdate).not.toHaveBeenCalled()
    expect(submitFilters).toEqual([])
    expect(authenticityUpdate).toHaveBeenCalledWith('id', 'doc-1')
  })

  it('returns an already-submitted document idempotently without changing its timestamp', async () => {
    const historyInsert = vi.fn(async () => ({ error: null }))
    const originalSubmittedAt = '2026-04-20T14:30:00.000Z'
    const submittedContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Finished work' }] }],
    }
    const updateDoc = vi.fn((payload: Record<string, unknown>) => ({
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
    }))
    vi.mocked(submitAssignmentDocAtomic).mockResolvedValueOnce({
      ok: true,
      doc: {
        id: 'doc-1',
        student_id: 'student-1',
        content: submittedContent,
        is_submitted: true,
        submitted_at: originalSubmittedAt,
        updated_at: originalSubmittedAt,
      } as any,
      historyEntry: {
        id: 'history-submit',
        assignment_doc_id: 'doc-1',
        trigger: 'submit',
        snapshot: submittedContent,
      } as any,
      idempotent: true,
    })

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
                  data: {
                    id: 'doc-1',
                    student_id: 'student-1',
                    content: submittedContent,
                    is_submitted: true,
                    submitted_at: originalSubmittedAt,
                    updated_at: originalSubmittedAt,
                  },
                  error: null,
                }),
              })),
            })),
          })),
          update: updateDoc,
        }
      }

      if (table === 'assignment_doc_history') {
        return {
          insert: historyInsert,
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const semanticallyIdenticalContent = {
      content: [{ content: [{ text: 'Finished work', type: 'text' }], type: 'paragraph' }],
      type: 'doc',
    }
    const response = await POST(new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: semanticallyIdenticalContent,
        expected_updated_at: originalSubmittedAt,
      }),
    }), { params: { id: 'assign-1' } })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(updateDoc).not.toHaveBeenCalled()
    expect(data.doc.submitted_at).toBe(originalSubmittedAt)
    expect(submitAssignmentDocAtomic).toHaveBeenCalledWith(expect.objectContaining({
      expectedUpdatedAt: originalSubmittedAt,
    }))
  })

  it('rejects content changes to an already-submitted document', async () => {
    const savedContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Submitted work' }] }],
    }
    const changedContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Changed afterward' }] }],
    }
    const updateDoc = vi.fn()

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
                  data: {
                    id: 'doc-1',
                    student_id: 'student-1',
                    content: savedContent,
                    is_submitted: true,
                    submitted_at: '2026-04-20T14:30:00.000Z',
                    updated_at: '2026-04-20T14:30:00.000Z',
                  },
                  error: null,
                }),
              })),
            })),
          })),
          update: updateDoc,
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: changedContent,
        expected_updated_at: '2026-04-20T14:30:00.000Z',
      }),
    }), { params: { id: 'assign-1' } })
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('This assignment is already submitted and cannot be changed.')
    expect(updateDoc).not.toHaveBeenCalled()
  })

  it('rejects submission when the saved document revision changed', async () => {
    const content = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ready to submit' }] }],
    }
    const submitFilters: Array<[string, unknown]> = []
    const submitChain = {
      eq: vi.fn((column: string, value: unknown) => {
        submitFilters.push([column, value])
        return submitChain
      }),
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
      })),
    }
    const historyInsert = vi.fn()
    vi.mocked(submitAssignmentDocAtomic).mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: 'Your saved draft changed before submission. Review it and try again.',
      errorCode: 'assignment_doc_revision_conflict',
    })

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
                  data: {
                    id: 'doc-1',
                    student_id: 'student-1',
                    content,
                    is_submitted: false,
                    submitted_at: null,
                    updated_at: '2026-04-20T14:31:00.000Z',
                  },
                  error: null,
                }),
              })),
            })),
          })),
          update: vi.fn(() => submitChain),
        }
      }
      if (table === 'assignment_doc_history') {
        return { insert: historyInsert }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const staleRevision = '2026-04-20T14:30:00.000Z'
    const response = await POST(new NextRequest('http://localhost:3000/api/assignment-docs/assign-1/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, expected_updated_at: staleRevision }),
    }), { params: { id: 'assign-1' } })
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('Your saved draft changed before submission. Review it and try again.')
    expect(submitFilters).toEqual([])
    expect(submitAssignmentDocAtomic).toHaveBeenCalledWith(expect.objectContaining({
      expectedUpdatedAt: staleRevision,
    }))
    expect(historyInsert).not.toHaveBeenCalled()
  })

  it('still returns the atomically submitted doc when authenticity side effects fail', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const submittedContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Finished work' }] }],
    }
    vi.mocked(submitAssignmentDocAtomic).mockResolvedValueOnce({
      ok: true,
      doc: {
        id: 'doc-1',
        assignment_id: 'assign-1',
        student_id: 'student-1',
        content: submittedContent,
        is_submitted: true,
        submitted_at: '2026-04-25T12:00:00.000Z',
        updated_at: '2026-04-25T12:00:00.000Z',
      } as any,
      historyEntry: null,
    })

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
        const submitChain = {
          eq: vi.fn(() => submitChain),
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
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'doc-1',
                    student_id: 'student-1',
                    content: submittedContent,
                    updated_at: '2026-04-25T11:59:00.000Z',
                  },
                  error: null,
                }),
              })),
            })),
          })),
          update: vi.fn(() => submitChain),
        }
      }

      if (table === 'assignment_doc_history') {
        return {
          insert: vi.fn(async () => ({ error: { message: 'history failed' } })),
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: submittedContent,
        expected_updated_at: '2026-04-25T11:59:00.000Z',
      }),
    }), { params: { id: 'assign-1' } })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.doc).toEqual(expect.objectContaining({
      id: 'doc-1',
      is_submitted: true,
    }))
    expect(submitAssignmentDocAtomic).toHaveBeenCalledWith(expect.objectContaining({
      content: submittedContent,
      expectedUpdatedAt: '2026-04-25T11:59:00.000Z',
    }))
    expect(consoleError).toHaveBeenCalledWith('Error computing authenticity score:', expect.any(Error))
    consoleError.mockRestore()
  })

  it('rejects bodyless submissions from cached legacy clients', async () => {
    const response = await POST(new NextRequest(
      'http://localhost:3000/api/assignment-docs/assign-1/submit',
      { method: 'POST' }
    ), { params: { id: 'assign-1' } })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Reload this assignment before submitting from an older browser tab.',
    })
    expect(submitAssignmentDocAtomic).not.toHaveBeenCalled()
  })
})

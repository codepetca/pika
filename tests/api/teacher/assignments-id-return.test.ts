import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/assignments/[id]/return/route'

const { appendAssignmentFeedbackEntry } = vi.hoisted(() => ({
  appendAssignmentFeedbackEntry: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({
    id: 'teacher-1',
    email: 'teacher@example.com',
    role: 'teacher',
  })),
}))

vi.mock('@/lib/server/assignment-feedback', () => ({
  appendAssignmentFeedbackEntry,
}))

const mockSupabaseClient = { from: vi.fn() }

function buildAssignmentDocsTable(options?: {
  docs?: any[]
  selectError?: any
  clearUpdateError?: any
  returnUpdateError?: any
  feedbackUpdateError?: any
}) {
  const docs = options?.docs ?? []
  const update = vi.fn((payload: Record<string, unknown>) => ({
    eq: vi.fn(() => {
      if ('returned_at' in payload) {
        return {
          in: vi.fn().mockResolvedValue({
            error: options?.returnUpdateError ?? null,
          }),
        }
      }
      if ('teacher_cleared_at' in payload || payload.is_submitted === false) {
        return {
          in: vi.fn().mockResolvedValue({
            error: options?.clearUpdateError ?? null,
          }),
        }
      }
      return Promise.resolve({
        error: options?.feedbackUpdateError ?? null,
      })
    }),
  }))

  return {
    table: {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn().mockResolvedValue({
            data: docs,
            error: options?.selectError ?? null,
          }),
        })),
      })),
      update,
    },
    update,
  }
}

describe('POST /api/teacher/assignments/[id]/return', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appendAssignmentFeedbackEntry.mockResolvedValue({
      id: 'entry-1',
    })
  })

  it('returns 400 when student_ids is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/return', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('student_ids array is required')
  })

  it('clears submitted docs and fully returns only graded ones', async () => {
    const docs = [
      {
        id: 'doc-1',
        student_id: 'student-1',
        is_submitted: true,
        score_completion: 4,
        score_thinking: 4,
        score_workflow: 4,
        teacher_feedback_draft: 'Strong work',
      },
      {
        id: 'doc-2',
        student_id: 'student-2',
        is_submitted: true,
        score_completion: null,
        score_thinking: 3,
        score_workflow: 3,
        teacher_feedback_draft: '',
      },
      {
        id: 'doc-3',
        student_id: 'student-3',
        is_submitted: false,
        score_completion: null,
        score_thinking: 3,
        score_workflow: 3,
        teacher_feedback_draft: 'Missing completion score',
      },
    ]

    const assignmentDocsTable = buildAssignmentDocsTable({ docs })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'assignment-1',
                  classroom_id: 'classroom-1',
                  classrooms: { teacher_id: 'teacher-1' },
                },
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'assignment_docs') {
        return assignmentDocsTable.table
      }

      throw new Error(`Unexpected table in test: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/return', {
      method: 'POST',
      body: JSON.stringify({
        student_ids: ['student-1', 'student-2', 'student-3'],
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.returned_count).toBe(1)
    expect(data.cleared_count).toBe(2)
    expect(data.missing_count).toBe(1)

    const payloads = assignmentDocsTable.update.mock.calls.map(([payload]) => payload)
    expect(payloads).toEqual(expect.arrayContaining([
      expect.objectContaining({
        teacher_cleared_at: expect.any(String),
      }),
      expect.objectContaining({
        is_submitted: false,
        returned_at: expect.any(String),
        feedback_returned_at: expect.any(String),
      }),
    ]))
    expect(
      payloads.some((payload: any) =>
        payload.is_submitted === false
        && typeof payload.teacher_cleared_at === 'string'
        && !('returned_at' in payload)
        && !('feedback_returned_at' in payload)
      )
    ).toBe(true)

    expect(appendAssignmentFeedbackEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId: 'assignment-1',
        studentId: 'student-1',
        createdBy: 'teacher-1',
        body: 'Strong work',
      })
    )
  })

  it('returns graded missing work even when it was never submitted', async () => {
    const docs = [
      {
        id: 'doc-1',
        student_id: 'student-1',
        is_submitted: false,
        score_completion: 0,
        score_thinking: 0,
        score_workflow: 0,
        teacher_feedback_draft: 'Missing',
      },
    ]

    const assignmentDocsTable = buildAssignmentDocsTable({ docs })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'assignment-1',
                  classroom_id: 'classroom-1',
                  classrooms: { teacher_id: 'teacher-1' },
                },
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'assignment_docs') {
        return assignmentDocsTable.table
      }

      throw new Error(`Unexpected table in test: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/return', {
      method: 'POST',
      body: JSON.stringify({
        student_ids: ['student-1'],
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.returned_count).toBe(1)
    expect(data.cleared_count).toBe(0)
    expect(data.missing_count).toBe(0)

    expect(assignmentDocsTable.update).toHaveBeenCalledWith(
      expect.objectContaining({
        is_submitted: false,
        returned_at: expect.any(String),
        feedback_returned_at: expect.any(String),
        teacher_cleared_at: expect.any(String),
      }),
    )
    expect(appendAssignmentFeedbackEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId: 'assignment-1',
        studentId: 'student-1',
        createdBy: 'teacher-1',
        body: 'Missing',
      }),
    )
  })

  it('returns 500 when returning docs update fails', async () => {
    const assignmentDocsTable = buildAssignmentDocsTable({
      docs: [
        {
          id: 'doc-1',
          student_id: 'student-1',
          is_submitted: true,
          score_completion: 4,
          score_thinking: 4,
          score_workflow: 4,
          teacher_feedback_draft: '',
        },
      ],
      returnUpdateError: { message: 'boom' },
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'assignment-1',
                  classroom_id: 'classroom-1',
                  classrooms: { teacher_id: 'teacher-1' },
                },
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'assignment_docs') {
        return assignmentDocsTable.table
      }

      throw new Error(`Unexpected table in test: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/return', {
      method: 'POST',
      body: JSON.stringify({
        student_ids: ['student-1'],
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
    const data = await response.json()
    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to return docs')
  })

  it('returns 500 when mailbox clear update fails for reasons other than missing column', async () => {
    const assignmentDocsTable = buildAssignmentDocsTable({
      docs: [
        {
          id: 'doc-1',
          student_id: 'student-1',
          is_submitted: true,
          score_completion: null,
          score_thinking: null,
          score_workflow: null,
          teacher_feedback_draft: '',
        },
      ],
      clearUpdateError: { code: '23505', message: 'boom' },
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'assignment-1',
                  classroom_id: 'classroom-1',
                  classrooms: { teacher_id: 'teacher-1' },
                },
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'assignment_docs') {
        return assignmentDocsTable.table
      }

      throw new Error(`Unexpected table in test: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/return', {
      method: 'POST',
      body: JSON.stringify({
        student_ids: ['student-1'],
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to clear assignment mailbox')
  })
})

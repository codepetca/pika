import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/assignments/[id]/feedback-return/route'

const { appendAssignmentFeedbackEntry, assertTeacherOwnsAssignment } = vi.hoisted(() => ({
  appendAssignmentFeedbackEntry: vi.fn(),
  assertTeacherOwnsAssignment: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({
    id: 'teacher-1',
    email: 'teacher@example.com',
    role: 'teacher',
  })),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/server/assignment-feedback', () => ({
  appendAssignmentFeedbackEntry,
}))

vi.mock('@/lib/server/repo-review', () => ({
  assertTeacherOwnsAssignment,
}))

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/teacher/assignments/[id]/feedback-return', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appendAssignmentFeedbackEntry.mockResolvedValue({ id: 'entry-1' })
    assertTeacherOwnsAssignment.mockResolvedValue({
      id: 'assignment-1',
      classroom_id: 'classroom-1',
    })
  })

  it('returns feedback without clearing mailbox state', async () => {
    const existingDoc = {
      id: 'doc-1',
      assignment_id: 'assignment-1',
      student_id: 'student-1',
      content: { type: 'doc', content: [] },
      is_submitted: true,
      submitted_at: '2026-03-20T12:00:00.000Z',
      teacher_feedback_draft: 'Draft feedback',
    }

    const upsert = vi.fn((payload: Record<string, unknown>) => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { ...existingDoc, ...payload },
          error: null,
        }),
      })),
    }))

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'enrollment-1' },
                  error: null,
                }),
              })),
            })),
          })),
        }
      }

      if (table === 'assignment_docs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: existingDoc,
                  error: null,
                }),
              })),
            })),
          })),
          upsert,
        }
      }

      throw new Error(`Unexpected table in test: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/feedback-return', {
      method: 'POST',
      body: JSON.stringify({
        student_id: 'student-1',
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
    const data = await response.json()
    const [payload, options] = upsert.mock.calls[0]

    expect(response.status).toBe(200)
    expect(payload).toEqual(expect.objectContaining({
      is_submitted: true,
      submitted_at: '2026-03-20T12:00:00.000Z',
      feedback_returned_at: expect.any(String),
    }))
    expect(payload).not.toHaveProperty('teacher_cleared_at')
    expect(payload).not.toHaveProperty('returned_at')
    expect(options).toEqual(expect.objectContaining({ onConflict: 'assignment_id,student_id' }))
    expect(data.doc.is_submitted).toBe(true)
  })
})

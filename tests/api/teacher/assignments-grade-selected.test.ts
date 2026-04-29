import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/assignments/[id]/grade-selected/route'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))

const mockSupabaseClient = { from: vi.fn() }

function buildAssignmentTable() {
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

function buildEnrollmentsTable(studentIds: string[]) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        in: vi.fn().mockResolvedValue({
          data: studentIds.map((student_id) => ({ student_id })),
          error: null,
        }),
      })),
    })),
  }
}

function buildAssignmentDocsTable(capturedRows: Array<Record<string, unknown>[]>) {
  return {
    upsert: vi.fn((rows: Array<Record<string, unknown>>) => {
      capturedRows.push(rows)
      return {
        select: vi.fn().mockResolvedValue({
          data: rows.map((row, index) => ({
            id: `doc-${index + 1}`,
            ...row,
            updated_at: '2026-04-12T12:00:00Z',
          })),
          error: null,
        }),
      }
    }),
  }
}

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/grade-selected', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/teacher/assignments/[id]/grade-selected', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when student_ids is missing', async () => {
    const response = await POST(makeRequest({
      score_completion: 7,
      score_thinking: 8,
      score_workflow: 9,
      feedback: 'Shared feedback',
    }), { params: Promise.resolve({ id: 'assignment-1' }) })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('student_ids array is required')
  })

  it('returns 400 when more than 100 unique students are selected', async () => {
    const response = await POST(makeRequest({
      student_ids: Array.from({ length: 101 }, (_, index) => `student-${index}`),
      score_completion: 7,
      score_thinking: 8,
      score_workflow: 9,
      feedback: 'Shared feedback',
    }), { params: Promise.resolve({ id: 'assignment-1' }) })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Cannot grade more than 100 students at once')
  })

  it('returns 400 for invalid final scores', async () => {
    const response = await POST(makeRequest({
      student_ids: ['student-1'],
      score_completion: 11,
      score_thinking: 8,
      score_workflow: 9,
      feedback: 'Shared feedback',
      save_mode: 'graded',
    }), { params: Promise.resolve({ id: 'assignment-1' }) })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('score_completion must be an integer 0–10')
  })

  it('rejects selected students outside the assignment classroom', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') return buildAssignmentTable()
      if (table === 'classroom_enrollments') return buildEnrollmentsTable(['student-1'])
      throw new Error(`Unexpected table in test: ${table}`)
    })

    const response = await POST(makeRequest({
      student_ids: ['student-1', 'student-2'],
      score_completion: 7,
      score_thinking: 8,
      score_workflow: 9,
      feedback: 'Shared feedback',
      save_mode: 'graded',
    }), { params: Promise.resolve({ id: 'assignment-1' }) })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Student is not enrolled in this classroom')
  })

  it('upserts the same final grade for unique selected students without returning feedback', async () => {
    const capturedRows: Array<Record<string, unknown>[]> = []

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') return buildAssignmentTable()
      if (table === 'classroom_enrollments') return buildEnrollmentsTable(['student-1', 'student-2'])
      if (table === 'assignment_docs') return buildAssignmentDocsTable(capturedRows)
      throw new Error(`Unexpected table in test: ${table}`)
    })

    const response = await POST(makeRequest({
      student_ids: ['student-1', 'student-2', 'student-1'],
      score_completion: 7,
      score_thinking: 8,
      score_workflow: 9,
      feedback: 'Shared feedback',
      save_mode: 'graded',
    }), { params: Promise.resolve({ id: 'assignment-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.updated_count).toBe(2)
    expect(body.updated_student_ids).toEqual(['student-1', 'student-2'])
    expect(capturedRows[0]).toHaveLength(2)
    expect(capturedRows[0][0]).toEqual(expect.objectContaining({
      assignment_id: 'assignment-1',
      student_id: 'student-1',
      score_completion: 7,
      score_thinking: 8,
      score_workflow: 9,
      teacher_feedback_draft: 'Shared feedback',
      teacher_feedback_draft_updated_at: expect.any(String),
      graded_at: expect.any(String),
      graded_by: 'teacher',
    }))
    expect(capturedRows[0][0]).not.toHaveProperty('feedback')
    expect(capturedRows[0][0]).not.toHaveProperty('feedback_returned_at')
    expect(capturedRows[0][0]).not.toHaveProperty('returned_at')
  })

  it('allows draft batch grades with blank scores and does not mark graded', async () => {
    const capturedRows: Array<Record<string, unknown>[]> = []

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignments') return buildAssignmentTable()
      if (table === 'classroom_enrollments') return buildEnrollmentsTable(['student-1', 'student-2'])
      if (table === 'assignment_docs') return buildAssignmentDocsTable(capturedRows)
      throw new Error(`Unexpected table in test: ${table}`)
    })

    const response = await POST(makeRequest({
      student_ids: ['student-1', 'student-2'],
      score_completion: '',
      score_thinking: 8,
      score_workflow: null,
      feedback: 'Draft feedback',
      save_mode: 'draft',
    }), { params: Promise.resolve({ id: 'assignment-1' }) })

    expect(response.status).toBe(200)
    expect(capturedRows[0][0]).toEqual(expect.objectContaining({
      score_completion: null,
      score_thinking: 8,
      score_workflow: null,
      teacher_feedback_draft: 'Draft feedback',
      graded_at: null,
      graded_by: null,
    }))
  })
})

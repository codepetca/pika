import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  createOrResumeAssignmentAiGradingRun,
  gradeAssignmentDocWithAi,
  markAssignmentDocMissingGrade,
} = vi.hoisted(() => ({
  createOrResumeAssignmentAiGradingRun: vi.fn(),
  gradeAssignmentDocWithAi: vi.fn(),
  markAssignmentDocMissingGrade: vi.fn(),
}))

const { assertTeacherOwnsAssignment } = vi.hoisted(() => ({
  assertTeacherOwnsAssignment: vi.fn(),
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

vi.mock('@/lib/server/assignment-ai-grading-runs', () => ({
  createOrResumeAssignmentAiGradingRun,
  gradeAssignmentDocWithAi,
  markAssignmentDocMissingGrade,
}))

vi.mock('@/lib/server/repo-review', () => ({
  assertTeacherOwnsAssignment,
}))

import { POST } from '@/app/api/teacher/assignments/[id]/auto-grade/route'

const mockSupabaseClient = { from: vi.fn() }

function buildEnrollmentTable(opts?: { enrolledIds?: string[]; error?: unknown }) {
  const enrolledIds = opts?.enrolledIds ?? []
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        in: vi.fn().mockResolvedValue({
          data: enrolledIds.map((student_id) => ({ student_id })),
          error: opts?.error ?? null,
        }),
      })),
    })),
  }
}

function mockAutoGradeTables(opts: {
  enrolledIds: string[]
  assignmentDocsTable?: unknown
  enrollmentError?: unknown
}) {
  ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
    if (table === 'classroom_enrollments') {
      return buildEnrollmentTable({
        enrolledIds: opts.enrolledIds,
        error: opts.enrollmentError,
      })
    }

    if (table === 'assignment_docs' && opts.assignmentDocsTable) {
      return opts.assignmentDocsTable
    }

    throw new Error(`Unexpected table: ${table}`)
  })
}

describe('POST /api/teacher/assignments/[id]/auto-grade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    assertTeacherOwnsAssignment.mockResolvedValue({
      id: 'assignment-1',
      classroom_id: 'classroom-1',
      title: 'Portfolio Site',
      instructions_markdown: 'Build and submit your portfolio site.',
      rich_instructions: null,
      description: 'Build and submit your portfolio site.',
      due_at: '2099-05-01T12:00:00.000Z',
      position: 0,
      is_draft: false,
      released_at: null,
      track_authenticity: true,
      created_by: 'teacher-1',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      classrooms: { teacher_id: 'teacher-1' },
    })
    gradeAssignmentDocWithAi.mockResolvedValue(undefined)
    markAssignmentDocMissingGrade.mockResolvedValue(undefined)
    createOrResumeAssignmentAiGradingRun.mockResolvedValue({
      kind: 'created',
      run: {
        id: 'run-1',
        assignment_id: 'assignment-1',
        status: 'queued',
        model: 'gpt-5-nano',
        requested_count: 2,
        gradable_count: 2,
        processed_count: 0,
        completed_count: 0,
        skipped_missing_count: 0,
        skipped_empty_count: 0,
        failed_count: 0,
        pending_count: 2,
        next_retry_at: null,
        error_samples: [],
        started_at: null,
        completed_at: null,
        created_at: '2026-04-20T12:00:00.000Z',
      },
    })
  })

  it('grades a single legacy stringified assignment doc synchronously', async () => {
    mockAutoGradeTables({
      enrolledIds: ['student-1'],
      assignmentDocsTable: {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'doc-1',
                  student_id: 'student-1',
                  content: JSON.stringify({
                    type: 'doc',
                    content: [
                      {
                        type: 'paragraph',
                        content: [
                          {
                            type: 'text',
                            text: 'My portfolio is attached here.',
                          },
                        ],
                      },
                    ],
                  }),
                  feedback: 'Earlier feedback',
                  authenticity_score: 42,
                },
                error: null,
              }),
            })),
          })),
        })),
      },
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/auto-grade', {
      method: 'POST',
      body: JSON.stringify({
        student_ids: ['student-1'],
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      graded_count: 1,
      skipped_count: 0,
      errors: undefined,
    })
    expect(gradeAssignmentDocWithAi).toHaveBeenCalledTimes(1)
    expect(gradeAssignmentDocWithAi).toHaveBeenCalledWith(
      expect.objectContaining({
        assignment: expect.objectContaining({ id: 'assignment-1', title: 'Portfolio Site' }),
        assignmentDoc: expect.objectContaining({
          id: 'doc-1',
          student_id: 'student-1',
          feedback: 'Earlier feedback',
        }),
        gradedBy: 'teacher-1',
        telemetry: expect.objectContaining({
          operation: 'single_grade',
          studentId: 'student-1',
        }),
      }),
    )
  })

  it('marks legacy stringified empty docs as missing without calling the grader', async () => {
    mockAutoGradeTables({
      enrolledIds: ['student-1'],
      assignmentDocsTable: {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'doc-1',
                  student_id: 'student-1',
                  content: JSON.stringify({ type: 'doc', content: [] }),
                  feedback: null,
                  authenticity_score: 42,
                },
                error: null,
              }),
            })),
          })),
        })),
      },
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/auto-grade', {
      method: 'POST',
      body: JSON.stringify({
        student_ids: ['student-1'],
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      graded_count: 1,
      skipped_count: 0,
      errors: undefined,
    })
    expect(gradeAssignmentDocWithAi).not.toHaveBeenCalled()
    expect(markAssignmentDocMissingGrade).toHaveBeenCalledWith({
      supabase: mockSupabaseClient,
      assignmentId: 'assignment-1',
      studentId: 'student-1',
      gradedBy: 'teacher-1',
    })
  })

  it('creates a missing grade when no assignment doc exists', async () => {
    mockAutoGradeTables({
      enrolledIds: ['student-1'],
      assignmentDocsTable: {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            })),
          })),
        })),
      },
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/auto-grade', {
      method: 'POST',
      body: JSON.stringify({
        student_ids: ['student-1'],
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      graded_count: 1,
      skipped_count: 0,
      errors: undefined,
    })
    expect(gradeAssignmentDocWithAi).not.toHaveBeenCalled()
    expect(markAssignmentDocMissingGrade).toHaveBeenCalledWith({
      supabase: mockSupabaseClient,
      assignmentId: 'assignment-1',
      studentId: 'student-1',
      gradedBy: 'teacher-1',
    })
  })

  it('starts a resumable batch run for multi-student requests', async () => {
    mockAutoGradeTables({
      enrolledIds: ['student-1', 'student-2'],
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/auto-grade', {
      method: 'POST',
      body: JSON.stringify({
        student_ids: ['student-1', 'student-2'],
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
    const data = await response.json()

    expect(response.status).toBe(202)
    expect(data).toEqual({
      mode: 'background',
      run: expect.objectContaining({
        id: 'run-1',
        assignment_id: 'assignment-1',
        requested_count: 2,
      }),
    })
    expect(createOrResumeAssignmentAiGradingRun).toHaveBeenCalledWith({
      assignmentId: 'assignment-1',
      teacherId: 'teacher-1',
      studentIds: ['student-1', 'student-2'],
    })
  })

  it('rejects single-student auto-grade for a non-enrolled student id', async () => {
    mockAutoGradeTables({
      enrolledIds: [],
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/auto-grade', {
      method: 'POST',
      body: JSON.stringify({
        student_ids: ['student-404'],
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({
      error: 'Student is not enrolled in this classroom',
    })
    expect(markAssignmentDocMissingGrade).not.toHaveBeenCalled()
    expect(gradeAssignmentDocWithAi).not.toHaveBeenCalled()
  })

  it('rejects batch auto-grade when any requested student is not enrolled', async () => {
    mockAutoGradeTables({
      enrolledIds: ['student-1'],
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/auto-grade', {
      method: 'POST',
      body: JSON.stringify({
        student_ids: ['student-1', 'student-404'],
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({
      error: 'Student is not enrolled in this classroom',
    })
    expect(createOrResumeAssignmentAiGradingRun).not.toHaveBeenCalled()
    expect(markAssignmentDocMissingGrade).not.toHaveBeenCalled()
  })

  it('returns the active run when another selection is already in progress', async () => {
    createOrResumeAssignmentAiGradingRun.mockResolvedValueOnce({
      kind: 'conflict',
      run: {
        id: 'run-2',
        assignment_id: 'assignment-1',
        status: 'running',
        model: 'gpt-5-nano',
        requested_count: 3,
        gradable_count: 3,
        processed_count: 1,
        completed_count: 1,
        skipped_missing_count: 0,
        skipped_empty_count: 0,
        failed_count: 0,
        pending_count: 2,
        next_retry_at: null,
        error_samples: [],
        started_at: '2026-04-20T12:00:00.000Z',
        completed_at: null,
        created_at: '2026-04-20T12:00:00.000Z',
      },
    })
    mockAutoGradeTables({
      enrolledIds: ['student-1', 'student-2'],
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/auto-grade', {
      method: 'POST',
      body: JSON.stringify({
        student_ids: ['student-1', 'student-2'],
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data).toEqual({
      error: 'Another assignment AI grading run is already active',
      mode: 'background',
      run: expect.objectContaining({
        id: 'run-2',
        status: 'running',
      }),
    })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/assignments/[id]/repo-review/apply/route'

vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/server/repo-review', () => ({
  assertTeacherOwnsAssignment: vi.fn(async () => ({
    id: 'assignment-1',
    classroom_id: 'classroom-1',
    evaluation_mode: 'repo_review',
    classrooms: { archived_at: null },
  })),
  loadLatestRepoReviewRun: vi.fn(async () => ({ id: 'run-2', status: 'failed' })),
  loadLatestCompletedRepoReviewRun: vi.fn(async () => ({ id: 'run-1', status: 'completed' })),
  loadRepoReviewResults: vi.fn(async () => ([
    {
      student_id: 'student-1',
      draft_score_completion: 8,
      draft_score_thinking: 7,
      draft_score_workflow: 9,
      draft_feedback: 'Strong ownership and steady workflow.',
    },
  ])),
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/teacher/assignments/[id]/repo-review/apply', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('upserts provisional repo review scores into assignment docs', async () => {
    let capturedPayload: unknown = null

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignment_docs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            })),
          })),
          upsert: vi.fn((payload: unknown) => {
            capturedPayload = payload
            return Promise.resolve({ error: null })
          }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/repo-review/apply', {
      method: 'POST',
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'assignment-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.applied_count).toBe(1)
    expect(body.run_id).toBe('run-1')
    expect(body.latest_run_id).toBe('run-2')
    expect(capturedPayload).toEqual([
      {
        assignment_id: 'assignment-1',
        student_id: 'student-1',
        score_completion: 8,
        score_thinking: 7,
        score_workflow: 9,
        feedback: 'Strong ownership and steady workflow.',
        graded_at: null,
        graded_by: null,
        content: { type: 'doc', content: [] },
        is_submitted: false,
      },
    ])
  })
})

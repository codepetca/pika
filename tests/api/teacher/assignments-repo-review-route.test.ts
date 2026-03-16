import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/teacher/assignments/[id]/repo-review/route'

vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/server/repo-review', () => ({
  assertTeacherOwnsAssignment: vi.fn(async () => ({
    id: 'assignment-1',
    classroom_id: 'classroom-1',
    evaluation_mode: 'repo_review',
    due_at: '2026-03-20T23:59:59.000Z',
    classrooms: { id: 'classroom-1', title: 'Test Classroom', teacher_id: 'teacher-1', archived_at: null },
  })),
  loadRepoReviewConfig: vi.fn(async () => ({
    assignment_id: 'assignment-1',
    provider: 'github',
    repo_owner: 'codepetca',
    repo_name: 'pika-demo',
    default_branch: 'main',
    review_start_at: null,
    review_end_at: null,
    include_pr_reviews: true,
    config_json: {},
  })),
  loadRepoReviewRosterStudents: vi.fn(async () => ([
    {
      student_id: 'student-1',
      student_email: 'student1@example.com',
      student_name: 'Student One',
      github_identity: { github_login: 'student1', commit_emails: ['student1@example.com'] },
    },
  ])),
  loadLatestRepoReviewRun: vi.fn(async () => ({
    id: 'run-failed',
    assignment_id: 'assignment-1',
    status: 'failed',
    warnings_json: [{ message: 'Latest run failed' }],
  })),
  loadLatestCompletedRepoReviewRun: vi.fn(async () => ({
    id: 'run-completed',
    assignment_id: 'assignment-1',
    status: 'completed',
    warnings_json: [],
  })),
  loadRepoReviewResults: vi.fn(async (runId: string) => (
    runId === 'run-completed'
      ? [{
          student_id: 'student-1',
          timeline_json: [{ date: '2026-03-10', weighted_contribution: 1.2, commit_count: 2 }],
          weighted_contribution: 1.2,
          confidence: 0.8,
        }]
      : []
  )),
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/assignments', () => ({ calculateAssignmentStatus: vi.fn(() => 'returned') }))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/teacher/assignments/[id]/repo-review', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the latest completed run for results while still exposing the latest run status', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'assignment_docs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn().mockResolvedValue({
                data: [{
                  student_id: 'student-1',
                  score_completion: 8,
                  score_thinking: 7,
                  score_workflow: 9,
                  returned_at: '2026-03-12T14:00:00.000Z',
                  graded_at: '2026-03-12T13:00:00.000Z',
                  submitted_at: null,
                  updated_at: '2026-03-12T13:00:00.000Z',
                  is_submitted: false,
                }],
                error: null,
              }),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET({} as Request, { params: Promise.resolve({ id: 'assignment-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.latest_run.id).toBe('run-failed')
    expect(body.latest_completed_run.id).toBe('run-completed')
    expect(body.summary.confidence).toBe(0.8)
    expect(body.summary.warnings).toEqual([{ message: 'Latest run failed' }])
    expect(body.students[0].result.weighted_contribution).toBe(1.2)
  })
})

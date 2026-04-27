import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockSupabaseClient,
  mockAnalyzeRepoReviewAssignment,
  mockGradeRepoReviewFeedback,
  mockResolveAssignmentRepoTarget,
  mockSaveAssignmentRepoTarget,
  mockValidatePublicGitHubRepo,
  mockAssertTeacherOwnsAssignment,
} = vi.hoisted(() => ({
  mockSupabaseClient: { from: vi.fn() },
  mockAnalyzeRepoReviewAssignment: vi.fn(),
  mockGradeRepoReviewFeedback: vi.fn(),
  mockResolveAssignmentRepoTarget: vi.fn(),
  mockSaveAssignmentRepoTarget: vi.fn(),
  mockValidatePublicGitHubRepo: vi.fn(),
  mockAssertTeacherOwnsAssignment: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({ id: 'teacher-1', role: 'teacher' })),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/repo-review', () => ({
  REPO_REVIEW_METRICS_VERSION: 'metrics-v1',
  REPO_REVIEW_PROMPT_VERSION: 'prompt-v1',
  buildRepoReviewWindow: vi.fn(() => ({ start: null, end: null })),
  formatRepoReviewRepoName: vi.fn(() => 'codepetca/pika'),
  analyzeRepoReviewAssignment: mockAnalyzeRepoReviewAssignment,
}))

vi.mock('@/lib/repo-review-ai', () => ({
  gradeRepoReviewFeedback: mockGradeRepoReviewFeedback,
}))

vi.mock('@/lib/server/assignment-repo-targets', () => ({
  resolveAssignmentRepoTarget: mockResolveAssignmentRepoTarget,
  saveAssignmentRepoTarget: mockSaveAssignmentRepoTarget,
  validatePublicGitHubRepo: mockValidatePublicGitHubRepo,
}))

vi.mock('@/lib/server/repo-review', () => ({
  assertTeacherOwnsAssignment: mockAssertTeacherOwnsAssignment,
}))

import { POST } from '@/app/api/teacher/assignments/[id]/artifact-repo/run/route'

function installRepoRunTables(opts: {
  enrollments: Array<{ student_id: string; users: { email: string } }>
  profiles?: Array<{ user_id: string; first_name: string | null; last_name: string | null }>
  docs?: Array<Record<string, unknown>>
  targets?: Array<Record<string, unknown>>
}) {
  const insertedRuns: unknown[] = []
  const insertedResults: unknown[] = []
  const upsertedDocs: unknown[] = []
  const runUpdates: unknown[] = []

  mockSupabaseClient.from.mockImplementation((table: string) => {
    if (table === 'classroom_enrollments') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn(async () => ({ data: opts.enrollments, error: null })),
          })),
        })),
      }
    }

    if (table === 'student_profiles') {
      return {
        select: vi.fn(() => ({
          in: vi.fn(async () => ({ data: opts.profiles ?? [], error: null })),
        })),
      }
    }

    if (table === 'assignment_docs') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn(async () => ({ data: opts.docs ?? [], error: null })),
          })),
        })),
        upsert: vi.fn(async (rows: unknown[]) => {
          upsertedDocs.push(...rows)
          return { error: null }
        }),
      }
    }

    if (table === 'assignment_repo_targets') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn(async () => ({ data: opts.targets ?? [], error: null })),
          })),
        })),
      }
    }

    if (table === 'assignment_repo_review_runs') {
      return {
        insert: vi.fn((row: unknown) => {
          insertedRuns.push(row)
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: { id: 'run-1', ...(row as object) }, error: null })),
            })),
          }
        }),
        update: vi.fn((payload: unknown) => {
          runUpdates.push(payload)
          return { eq: vi.fn(async () => ({ error: null })) }
        }),
      }
    }

    if (table === 'assignment_repo_review_results') {
      return {
        insert: vi.fn(async (rows: unknown[]) => {
          insertedResults.push(...rows)
          return { error: null }
        }),
      }
    }

    throw new Error(`Unexpected table: ${table}`)
  })

  return { insertedRuns, insertedResults, upsertedDocs, runUpdates }
}

describe('POST /api/teacher/assignments/[id]/artifact-repo/run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.from.mockReset()
    mockAssertTeacherOwnsAssignment.mockResolvedValue({
      id: 'assignment-1',
      classroom_id: 'classroom-1',
      title: 'Repo review',
      due_at: '2026-04-20T03:59:00.000Z',
      released_at: '2026-04-01T12:00:00.000Z',
    })
  })

  it('rejects missing and oversized student id batches before touching Supabase', async () => {
    const emptyResponse = await POST(
      new NextRequest('http://localhost/api/teacher/assignments/assignment-1/artifact-repo/run', {
        method: 'POST',
        body: JSON.stringify({ student_ids: [] }),
      }),
      { params: { id: 'assignment-1' } },
    )
    expect(emptyResponse.status).toBe(400)

    const largeResponse = await POST(
      new NextRequest('http://localhost/api/teacher/assignments/assignment-1/artifact-repo/run', {
        method: 'POST',
        body: JSON.stringify({ student_ids: Array.from({ length: 101 }, (_, index) => `student-${index}`) }),
      }),
      { params: { id: 'assignment-1' } },
    )
    expect(largeResponse.status).toBe(400)
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })

  it('returns skipped reasons when enrolled students have no usable repo target', async () => {
    mockResolveAssignmentRepoTarget.mockReturnValue({
      effectiveRepoUrl: null,
      effectiveGitHubUsername: null,
      validationMessage: 'No repo link has been submitted yet.',
    })
    installRepoRunTables({
      enrollments: [{ student_id: 'student-1', users: { email: 's1@example.com' } }],
      docs: [{ student_id: 'student-1', repo_url: null, github_username: null }],
    })

    const response = await POST(
      new NextRequest('http://localhost/api/teacher/assignments/assignment-1/artifact-repo/run', {
        method: 'POST',
        body: JSON.stringify({ student_ids: ['student-1'] }),
      }),
      { params: { id: 'assignment-1' } },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      analyzed_students: 0,
      repo_groups: 0,
      skipped_reasons: { 'No repo link has been submitted yet.': 1 },
    })
    expect(mockValidatePublicGitHubRepo).not.toHaveBeenCalled()
  })

  it('groups valid repos, saves run results, and upserts draft grades', async () => {
    mockResolveAssignmentRepoTarget.mockReturnValue({
      effectiveRepoUrl: 'https://github.com/codepetca/pika',
      effectiveGitHubUsername: 'student-login',
      selectionMode: 'auto',
      validationMessage: null,
    })
    mockValidatePublicGitHubRepo.mockResolvedValue({
      repoUrl: 'https://github.com/codepetca/pika',
      repoOwner: 'codepetca',
      repoName: 'pika',
      defaultBranch: 'main',
      validationStatus: 'valid',
      validationMessage: null,
    })
    mockAnalyzeRepoReviewAssignment.mockResolvedValue({
      sourceRef: 'main',
      warnings: [{ code: 'note', message: 'Low commit count', student_id: 'student-1' }],
      confidence: 0.9,
      students: [{
        studentId: 'student-1',
        githubLogin: 'student-login',
        commitCount: 4,
        activeDays: 2,
        sessionCount: 1,
        burstRatio: 0.25,
        weightedContribution: 0.7,
        relativeContributionShare: 1,
        spreadScore: 0.8,
        iterationScore: 0.6,
        reviewActivityCount: 1,
        areas: ['src'],
        semanticBreakdown: { feature: 3 },
        timeline: [{ date: '2026-04-01', count: 2 }],
        evidence: [{ type: 'commit', message: 'Initial work' }],
      }],
    })
    mockGradeRepoReviewFeedback.mockResolvedValue({
      score_completion: 8,
      score_thinking: 7,
      score_workflow: 9,
      feedback: 'Solid repo activity.',
      confidence: 0.8,
    })
    const harness = installRepoRunTables({
      enrollments: [{ student_id: 'student-1', users: { email: 's1@example.com' } }],
      profiles: [{ user_id: 'student-1', first_name: 'Sam', last_name: 'Lee' }],
      docs: [{
        id: 'doc-1',
        student_id: 'student-1',
        content: { type: 'doc', content: [] },
        repo_url: 'https://github.com/codepetca/pika',
        github_username: 'student-login',
        is_submitted: true,
        submitted_at: '2026-04-02T12:00:00.000Z',
      }],
    })

    const response = await POST(
      new NextRequest('http://localhost/api/teacher/assignments/assignment-1/artifact-repo/run', {
        method: 'POST',
        body: JSON.stringify({ student_ids: ['student-1'] }),
      }),
      { params: { id: 'assignment-1' } },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ analyzed_students: 1, repo_groups: 1, skipped_reasons: {} })
    expect(mockSaveAssignmentRepoTarget).toHaveBeenCalledWith(expect.objectContaining({
      assignmentId: 'assignment-1',
      studentId: 'student-1',
      selectionMode: 'auto',
      validationStatus: 'valid',
      repoOwner: 'codepetca',
      repoName: 'pika',
    }))
    expect(harness.insertedRuns).toHaveLength(1)
    expect(harness.insertedResults).toEqual([
      expect.objectContaining({
        run_id: 'run-1',
        assignment_id: 'assignment-1',
        student_id: 'student-1',
        github_login: 'student-login',
        draft_score_completion: 8,
        draft_score_thinking: 7,
        draft_score_workflow: 9,
        draft_feedback: 'Solid repo activity.',
      }),
    ])
    expect(harness.upsertedDocs).toEqual([
      expect.objectContaining({
        assignment_id: 'assignment-1',
        student_id: 'student-1',
        score_completion: 8,
        score_thinking: 7,
        score_workflow: 9,
        ai_feedback_suggestion: 'Solid repo activity.',
        ai_feedback_model: 'repo-review-v2',
      }),
    ])
    expect(harness.runUpdates).toEqual([
      expect.objectContaining({
        status: 'completed',
        source_ref: 'main',
        model: 'repo-review-v2',
      }),
    ])
  })
})

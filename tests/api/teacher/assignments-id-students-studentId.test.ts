/**
 * API tests for GET /api/teacher/assignments/[id]/students/[studentId]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/teacher/assignments/[id]/students/[studentId]/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabaseClient) }))
vi.mock('@/lib/auth', () => ({ requireRole: vi.fn(async () => ({ id: 'teacher-1' })) }))
vi.mock('@/lib/server/assignment-feedback', () => ({
  loadAssignmentFeedbackEntries: vi.fn(async () => []),
}))
vi.mock('@/lib/server/assignment-submission-artifacts', () => ({
  loadAssignmentSubmissionArtifactsForDoc: vi.fn(async () => []),
  loadAssignmentSubmissionRequirements: vi.fn(async () => []),
}))
vi.mock('@/lib/server/assignment-repo-targets', () => ({
  extractRepoArtifactsFromContent: vi.fn(() => []),
  loadAssignmentRepoTarget: vi.fn(async () => null),
  resolveAssignmentRepoTarget: vi.fn(() => ({
    selectedRepo: null,
    candidateRepos: [],
    resolution: 'missing',
  })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('GET /api/teacher/assignments/[id]/students/[studentId]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('should return 404 when assignment does not exist', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/a-999/students/s-1')
    const response = await GET(request, { params: { id: 'a-999', studentId: 's-1' } })
    expect(response.status).toBe(404)
  })

  it('should return 403 when not creator', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'a-1',
              created_by: 'other',
              classrooms: { teacher_id: 'other' },
            },
            error: null,
          }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/a-1/students/s-1')
    const response = await GET(request, { params: { id: 'a-1', studentId: 's-1' } })
    expect(response.status).toBe(403)
  })

  it.each([
    ['completed', true],
    ['failed', false],
    ['running', false],
  ])('returns repo-review results only for completed runs (%s)', async (runStatus, shouldReturn) => {
    const completedStatusFilter = vi.fn()
    const repoResult = {
      id: 'result-1',
      assignment_id: 'a-1',
      student_id: 's-1',
      draft_feedback: 'Review feedback',
      assignment_repo_review_runs: { status: runStatus },
    }

    mockSupabaseClient.from.mockImplementation((table: string) => {
      if (table === 'assignments') {
        return selectWithSingle({
          id: 'a-1',
          classroom_id: 'classroom-1',
          title: 'Assignment',
          description: null,
          instructions_markdown: '',
          rich_instructions: null,
          due_at: null,
          position: 0,
          created_by: 'teacher-1',
          created_at: '2026-07-14T12:00:00.000Z',
          updated_at: '2026-07-14T12:00:00.000Z',
          released_at: null,
          classrooms: { id: 'classroom-1', teacher_id: 'teacher-1', title: 'Classroom' },
        }, 1)
      }
      if (table === 'classroom_enrollments') {
        return selectWithSingle({ student_id: 's-1', users: { id: 's-1', email: 'student@example.test' } }, 2)
      }
      if (table === 'student_profiles') {
        return selectWithSingle({ first_name: 'Student', last_name: 'One' }, 1)
      }
      if (table === 'assignment_docs') {
        return selectWithSingle(null, 2)
      }
      if (table === 'assignment_repo_review_results') {
        const terminal = {
          order: vi.fn(() => ({
            limit: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: shouldReturn ? repoResult : null,
                error: null,
              })),
            })),
          })),
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: completedStatusFilter.mockImplementation(() => terminal),
              })),
            })),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/a-1/students/s-1')
    const response = await GET(request, { params: { id: 'a-1', studentId: 's-1' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(completedStatusFilter).toHaveBeenCalledWith('assignment_repo_review_runs.status', 'completed')
    expect(body.repo_target.latest_result).toEqual(
      shouldReturn
        ? expect.objectContaining({ id: 'result-1', draft_feedback: 'Review feedback' })
        : null,
    )
    if (shouldReturn) {
      expect(body.repo_target.latest_result).not.toHaveProperty('assignment_repo_review_runs')
    }
  })
})

function selectWithSingle(data: unknown, eqCount: number) {
  const terminal = { single: vi.fn(async () => ({ data, error: null })) }
  let query: unknown = terminal
  for (let index = 0; index < eqCount; index += 1) {
    const next = query
    query = { eq: vi.fn(() => next) }
  }
  return { select: vi.fn(() => query) }
}

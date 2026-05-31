import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockAssertTeacherCanMutateAssignment,
  mockExtractRepoArtifactsFromContent,
  mockLoadAssignmentRepoTarget,
  mockLoadAssignmentSubmissionArtifactsForDoc,
  mockResolveAssignmentRepoTarget,
  mockSaveAssignmentRepoTarget,
  mockSubmissionArtifactsToAssignmentArtifacts,
  mockSupabaseClient,
  mockValidatePublicGitHubRepo,
} = vi.hoisted(() => ({
  mockAssertTeacherCanMutateAssignment: vi.fn(),
  mockExtractRepoArtifactsFromContent: vi.fn(),
  mockLoadAssignmentRepoTarget: vi.fn(),
  mockLoadAssignmentSubmissionArtifactsForDoc: vi.fn(),
  mockResolveAssignmentRepoTarget: vi.fn(),
  mockSaveAssignmentRepoTarget: vi.fn(),
  mockSubmissionArtifactsToAssignmentArtifacts: vi.fn(),
  mockSupabaseClient: { from: vi.fn() },
  mockValidatePublicGitHubRepo: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({ id: 'teacher-1', role: 'teacher' })),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/server/repo-review', () => ({
  assertTeacherCanMutateAssignment: mockAssertTeacherCanMutateAssignment,
}))

vi.mock('@/lib/server/assignment-submission-artifacts', () => ({
  loadAssignmentSubmissionArtifactsForDoc: mockLoadAssignmentSubmissionArtifactsForDoc,
}))

vi.mock('@/lib/assignment-submission-requirements', () => ({
  submissionArtifactsToAssignmentArtifacts: mockSubmissionArtifactsToAssignmentArtifacts,
}))

vi.mock('@/lib/server/assignment-repo-targets', () => ({
  extractRepoArtifactsFromContent: mockExtractRepoArtifactsFromContent,
  loadAssignmentRepoTarget: mockLoadAssignmentRepoTarget,
  resolveAssignmentRepoTarget: mockResolveAssignmentRepoTarget,
  saveAssignmentRepoTarget: mockSaveAssignmentRepoTarget,
  validatePublicGitHubRepo: mockValidatePublicGitHubRepo,
}))

import { PUT } from '@/app/api/teacher/assignments/[id]/repo-targets/[studentId]/route'

function createRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/teacher/assignments/assignment-1/repo-targets/student-1', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

function createContext(studentId = 'student-1') {
  return {
    params: Promise.resolve({
      id: 'assignment-1',
      studentId,
    }),
  }
}

function installRepoTargetTables(opts: {
  enrollment?: { id?: string; student_id?: string } | null
  enrollmentError?: unknown
  existingDoc?: Record<string, unknown> | null
}) {
  const deleteEq = vi.fn(async () => ({ error: null }))
  const deleteTarget = vi.fn(() => ({ eq: deleteEq }))

  const from = vi.fn((table: string) => {
    if (table === 'classroom_enrollments') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn(async (_column: string, studentIds: string[]) => {
              const enrollment = opts.enrollment === undefined
                ? { id: 'enrollment-1', student_id: studentIds[0] }
                : opts.enrollment
              return {
                data: enrollment ? [enrollment] : [],
                error: opts.enrollmentError ?? null,
              }
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
              maybeSingle: vi.fn(async () => ({
                data: opts.existingDoc ?? {
                  id: 'doc-1',
                  content: { type: 'doc', content: [] },
                  repo_url: 'https://github.com/submitted/repo',
                  github_username: 'student-login',
                },
                error: null,
              })),
            })),
          })),
        })),
      }
    }

    if (table === 'assignment_repo_targets') {
      return {
        delete: deleteTarget,
      }
    }

    throw new Error(`Unexpected table in test: ${table}`)
  })

  mockSupabaseClient.from = from
  return { deleteEq, deleteTarget, from }
}

describe('PUT /api/teacher/assignments/[id]/repo-targets/[studentId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.from.mockReset?.()
    mockAssertTeacherCanMutateAssignment.mockResolvedValue({
      id: 'assignment-1',
      classroom_id: 'classroom-1',
    })
    mockExtractRepoArtifactsFromContent.mockReturnValue([])
    mockLoadAssignmentRepoTarget.mockResolvedValue(null)
    mockLoadAssignmentSubmissionArtifactsForDoc.mockResolvedValue([])
    mockResolveAssignmentRepoTarget.mockReturnValue({
      submittedRepoUrl: 'https://github.com/submitted/repo',
      submittedGitHubUsername: 'student-login',
    })
    mockSaveAssignmentRepoTarget.mockResolvedValue({
      id: 'target-1',
      assignment_id: 'assignment-1',
      student_id: 'student-1',
      selected_repo_url: 'https://github.com/codepetca/pika',
      override_github_username: 'student-login',
      selection_mode: 'teacher_override',
      validation_status: 'valid',
      validation_message: null,
    })
    mockSubmissionArtifactsToAssignmentArtifacts.mockReturnValue([])
    mockValidatePublicGitHubRepo.mockResolvedValue({
      repoUrl: 'https://github.com/codepetca/pika',
      repoOwner: 'codepetca',
      repoName: 'pika',
      defaultBranch: 'main',
      validationStatus: 'valid',
      validationMessage: null,
    })
  })

  it('rejects repo target changes for students who are not enrolled before reading docs', async () => {
    const { from } = installRepoTargetTables({ enrollment: null })

    const response = await PUT(createRequest({
      selection_mode: 'teacher_override',
      selected_repo_url: 'https://github.com/codepetca/pika',
      override_github_username: 'student-login',
    }), createContext('student-stale'))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Student is not enrolled in this classroom')
    expect(from).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith('classroom_enrollments')
    expect(mockLoadAssignmentRepoTarget).not.toHaveBeenCalled()
    expect(mockSaveAssignmentRepoTarget).not.toHaveBeenCalled()
  })

  it('fails closed when enrollment validation errors before reading docs', async () => {
    const { from } = installRepoTargetTables({ enrollmentError: { message: 'boom' } })

    const response = await PUT(createRequest({
      selection_mode: 'teacher_override',
      selected_repo_url: 'https://github.com/codepetca/pika',
    }), createContext())
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Internal server error')
    expect(from).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith('classroom_enrollments')
    expect(mockValidatePublicGitHubRepo).not.toHaveBeenCalled()
    expect(mockSaveAssignmentRepoTarget).not.toHaveBeenCalled()
  })

  it('saves an override only after validating current enrollment', async () => {
    installRepoTargetTables({})

    const response = await PUT(createRequest({
      selection_mode: 'teacher_override',
      selected_repo_url: 'https://github.com/codepetca/pika',
      override_github_username: 'student-login',
    }), createContext())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.repo_target).toEqual(expect.objectContaining({
      assignment_id: 'assignment-1',
      student_id: 'student-1',
      selection_mode: 'teacher_override',
    }))
    expect(mockLoadAssignmentRepoTarget).toHaveBeenCalledWith('assignment-1', 'student-1')
    expect(mockValidatePublicGitHubRepo).toHaveBeenCalledWith('https://github.com/codepetca/pika')
    expect(mockSaveAssignmentRepoTarget).toHaveBeenCalledWith(expect.objectContaining({
      assignmentId: 'assignment-1',
      studentId: 'student-1',
      repoUrl: 'https://github.com/codepetca/pika',
      overrideGitHubUsername: 'student-login',
      selectionMode: 'teacher_override',
      validationStatus: 'valid',
    }))
  })

  it('resets an existing override only after validating current enrollment', async () => {
    const { deleteEq, deleteTarget } = installRepoTargetTables({})
    mockLoadAssignmentRepoTarget.mockResolvedValue({
      id: 'target-1',
      assignment_id: 'assignment-1',
      student_id: 'student-1',
      selection_mode: 'teacher_override',
    })

    const response = await PUT(createRequest({
      selection_mode: 'auto',
    }), createContext())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.repo_target).toBeNull()
    expect(deleteTarget).toHaveBeenCalled()
    expect(deleteEq).toHaveBeenCalledWith('id', 'target-1')
    expect(mockSaveAssignmentRepoTarget).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSupabaseClient } = vi.hoisted(() => ({
  mockSupabaseClient: {
    from: vi.fn(),
  },
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

import {
  extractRepoArtifactsFromContent,
  loadAssignmentRepoTarget,
  resolveAssignmentRepoTarget,
  saveAssignmentRepoTarget,
  validatePublicGitHubRepo,
} from '@/lib/server/assignment-repo-targets'
import type { AssignmentRepoTarget } from '@/types'

function buildRepoTarget(overrides: Partial<AssignmentRepoTarget> = {}): AssignmentRepoTarget {
  return {
    id: 'target-1',
    assignment_id: 'assignment-1',
    student_id: 'student-1',
    selected_repo_url: null,
    override_github_username: null,
    repo_owner: null,
    repo_name: null,
    selection_mode: 'auto',
    validation_status: 'valid',
    validation_message: null,
    validated_at: null,
    created_at: '2026-04-25T12:00:00.000Z',
    updated_at: '2026-04-25T12:00:00.000Z',
    ...overrides,
  }
}

describe('assignment repo target helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.from.mockReset()
    vi.unstubAllGlobals()
    delete process.env.GITHUB_PAT
    delete process.env.GITHUB_FEEDBACK_TOKEN
  })

  it('extracts only GitHub repo artifacts from assignment content', () => {
    const artifacts = extractRepoArtifactsFromContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Repo https://github.com/codepetca/pika and site https://example.com' },
          ],
        },
        {
          type: 'image',
          attrs: { src: 'https://cdn.example.com/submission-images/shot.png' },
        },
      ],
    })

    expect(artifacts).toEqual([
      {
        type: 'repo',
        url: 'https://github.com/codepetca/pika',
        repo_owner: 'codepetca',
        repo_name: 'pika',
        normalized_url: 'https://github.com/codepetca/pika',
      },
    ])
  })

  it('uses a teacher override repo and username ahead of submitted values', () => {
    const resolved = resolveAssignmentRepoTarget({
      submittedRepoUrl: 'https://github.com/student/submitted',
      submittedGitHubUsername: 'student-login',
      target: buildRepoTarget({
        selected_repo_url: 'https://github.com/teacher/override',
        override_github_username: 'override-login',
        repo_owner: 'teacher',
        repo_name: 'override',
        selection_mode: 'teacher_override',
        validation_status: 'valid',
      }),
    })

    expect(resolved).toEqual(expect.objectContaining({
      effectiveRepoUrl: 'https://github.com/teacher/override',
      effectiveGitHubUsername: 'override-login',
      repoOwner: 'teacher',
      repoName: 'override',
      selectionMode: 'teacher_override',
      validationStatus: 'valid',
    }))
  })

  it('reports actionable missing and invalid states before repo analysis can run', () => {
    expect(resolveAssignmentRepoTarget({
      submittedRepoUrl: null,
      submittedGitHubUsername: 'student-login',
      target: null,
    })).toEqual(expect.objectContaining({
      effectiveRepoUrl: null,
      effectiveGitHubUsername: 'student-login',
      selectionMode: 'auto',
      validationStatus: 'missing',
      validationMessage: 'No repo link has been submitted yet.',
    }))

    expect(resolveAssignmentRepoTarget({
      submittedRepoUrl: 'github.com/codepetca/pika',
      submittedGitHubUsername: null,
      target: null,
    })).toEqual(expect.objectContaining({
      effectiveRepoUrl: 'github.com/codepetca/pika',
      effectiveGitHubUsername: null,
      validationStatus: 'invalid',
      validationMessage: 'GitHub username is required before repo analysis can run.',
    }))
  })

  it('validates public GitHub repositories and maps inaccessible/private repos to statuses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 403, ok: false })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: vi.fn(async () => ({ private: true, default_branch: 'trunk' })),
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: vi.fn(async () => ({ private: false, default_branch: 'main' })),
      })
    vi.stubGlobal('fetch', fetchMock)

    await expect(validatePublicGitHubRepo('not a repo')).resolves.toEqual({
      repoUrl: 'not a repo',
      repoOwner: '',
      repoName: '',
      defaultBranch: 'main',
      validationStatus: 'invalid',
      validationMessage: 'Repo URL must point to a GitHub repository.',
    })

    await expect(validatePublicGitHubRepo('codepetca/private')).resolves.toEqual(expect.objectContaining({
      repoUrl: 'https://github.com/codepetca/private',
      repoOwner: 'codepetca',
      repoName: 'private',
      validationStatus: 'inaccessible',
    }))

    await expect(validatePublicGitHubRepo('https://github.com/codepetca/secret')).resolves.toEqual(expect.objectContaining({
      repoUrl: 'https://github.com/codepetca/secret',
      defaultBranch: 'trunk',
      validationStatus: 'private',
    }))

    await expect(validatePublicGitHubRepo('https://github.com/codepetca/pika')).resolves.toEqual({
      repoUrl: 'https://github.com/codepetca/pika',
      repoOwner: 'codepetca',
      repoName: 'pika',
      defaultBranch: 'main',
      validationStatus: 'valid',
      validationMessage: null,
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('uses a configured GitHub token when validating repos', async () => {
    process.env.GITHUB_PAT = '  token-1  '
    const fetchMock = vi.fn(async () => ({
      status: 200,
      ok: true,
      json: vi.fn(async () => ({ private: false, default_branch: 'main' })),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await validatePublicGitHubRepo('codepetca/pika')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/codepetca/pika',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-1',
        }),
        cache: 'no-store',
      }),
    )
  })

  it('loads and saves repo targets through the assignment/student key', async () => {
    const saved = buildRepoTarget({
      selected_repo_url: 'https://github.com/codepetca/pika',
      override_github_username: 'student-login',
      repo_owner: 'codepetca',
      repo_name: 'pika',
      selection_mode: 'teacher_override',
    })

    const maybeSingle = vi.fn(async () => ({ data: saved, error: null }))
    const single = vi.fn(async () => ({ data: saved, error: null }))
    const upsert = vi.fn(() => ({ select: vi.fn(() => ({ single })) }))
    mockSupabaseClient.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
      })),
      upsert,
    })

    await expect(loadAssignmentRepoTarget('assignment-1', 'student-1')).resolves.toEqual(saved)
    await expect(saveAssignmentRepoTarget({
      assignmentId: 'assignment-1',
      studentId: 'student-1',
      repoUrl: 'https://github.com/codepetca/pika',
      overrideGitHubUsername: 'student-login',
      selectionMode: 'teacher_override',
      validationStatus: 'valid',
      validationMessage: null,
      repoOwner: 'codepetca',
      repoName: 'pika',
    })).resolves.toEqual(saved)

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        assignment_id: 'assignment-1',
        student_id: 'student-1',
        selected_repo_url: 'https://github.com/codepetca/pika',
        override_github_username: 'student-login',
        repo_owner: 'codepetca',
        repo_name: 'pika',
        selection_mode: 'teacher_override',
        validation_status: 'valid',
      }),
      { onConflict: 'assignment_id,student_id' },
    )
  })

  it('throws API errors when target load or save fails', async () => {
    mockSupabaseClient.from
      .mockReturnValueOnce({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: null, error: { message: 'boom' } })),
            })),
          })),
        })),
      })
      .mockReturnValueOnce({
        upsert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: null, error: { message: 'boom' } })),
          })),
        })),
      })

    await expect(loadAssignmentRepoTarget('assignment-1', 'student-1')).rejects.toThrow('Failed to load repo target')
    await expect(saveAssignmentRepoTarget({
      assignmentId: 'assignment-1',
      studentId: 'student-1',
      repoUrl: null,
      overrideGitHubUsername: null,
      selectionMode: 'auto',
      validationStatus: 'missing',
      validationMessage: 'No repo',
      repoOwner: null,
      repoName: null,
    })).rejects.toThrow('Failed to save repo target')
  })
})

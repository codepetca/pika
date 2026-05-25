import { describe, expect, it, vi } from 'vitest'
import {
  isBlockedPublicLinkHostname,
  normalizeGitHubLogin,
  normalizePublicUrl,
  validateAssignmentSubmissionArtifactValue,
} from '@/lib/server/assignment-submission-validation'

vi.mock('@/lib/server/assignment-repo-targets', () => ({
  validatePublicGitHubRepo: vi.fn(async (repoUrl: string) => ({
    repoUrl: 'https://github.com/codepetca/pika',
    repoOwner: 'codepetca',
    repoName: 'pika',
    defaultBranch: 'main',
    validationStatus: repoUrl.includes('missing') ? 'inaccessible' : 'valid',
    validationMessage: repoUrl.includes('missing') ? 'Repo could not be accessed.' : null,
  })),
}))

describe('assignment submission validation helpers', () => {
  it('normalizes GitHub logins without accepting invalid names', () => {
    expect(normalizeGitHubLogin('@student-dev')).toBe('student-dev')
    expect(normalizeGitHubLogin('-bad')).toBeNull()
    expect(normalizeGitHubLogin('bad-')).toBeNull()
    expect(normalizeGitHubLogin('')).toBeNull()
  })

  it('blocks local and private public-link hosts', () => {
    expect(isBlockedPublicLinkHostname('localhost')).toBe(true)
    expect(isBlockedPublicLinkHostname('192.168.1.10')).toBe(true)
    expect(isBlockedPublicLinkHostname('10.0.0.1')).toBe(true)
    expect(isBlockedPublicLinkHostname('example.com')).toBe(false)
    expect(normalizePublicUrl('https://example.com/demo')).toBe('https://example.com/demo')
    expect(normalizePublicUrl('http://localhost:3000/demo')).toBeNull()
  })

  it('validates repo links with normalized repo metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))

    const result = await validateAssignmentSubmissionArtifactValue({
      type: 'repo_link',
      url: 'https://github.com/codepetca/pika',
      githubLogin: '@student-dev',
    })

    expect(result).toEqual({
      validation_status: 'valid',
      validation_message: null,
      normalized_url: 'https://github.com/codepetca/pika',
      metadata_json: {
        repo_owner: 'codepetca',
        repo_name: 'pika',
        normalized_url: 'https://github.com/codepetca/pika',
        default_branch: 'main',
        github_login: 'student-dev',
      },
    })

    vi.unstubAllGlobals()
  })

  it('validates public links by format without server-side fetching arbitrary URLs', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await validateAssignmentSubmissionArtifactValue({
      type: 'link',
      url: 'https://example.com/missing',
    })

    expect(result).toEqual({
      validation_status: 'valid',
      validation_message: null,
      metadata_json: { validation: 'format_only' },
      normalized_url: 'https://example.com/missing',
    })
    expect(fetchSpy).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })
})

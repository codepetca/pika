import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isBlockedPublicLinkHostname,
  normalizeGitHubLogin,
  normalizePublicUrl,
  validateAssignmentSubmissionArtifactValue,
} from '@/lib/server/assignment-submission-validation'

const dnsMocks = vi.hoisted(() => ({
  lookup: vi.fn(),
}))

vi.mock('node:dns/promises', () => ({
  ...dnsMocks,
  default: dnsMocks,
}))

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
  beforeEach(() => {
    dnsMocks.lookup.mockReset()
    dnsMocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never)
  })

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

  it('marks public links inaccessible without blocking the artifact format', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))

    const result = await validateAssignmentSubmissionArtifactValue({
      type: 'link',
      url: 'https://example.com/missing',
    })

    expect(result.validation_status).toBe('inaccessible')
    expect(result.normalized_url).toBe('https://example.com/missing')

    vi.unstubAllGlobals()
  })

  it('rejects public links that resolve to private addresses before fetching them', async () => {
    dnsMocks.lookup.mockResolvedValue([{ address: '10.0.0.8', family: 4 }] as never)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await validateAssignmentSubmissionArtifactValue({
      type: 'link',
      url: 'https://student-demo.example',
    })

    expect(result).toEqual({
      validation_status: 'invalid',
      validation_message: 'Enter a public URL that does not resolve to a private or local address.',
      metadata_json: {},
      normalized_url: null,
    })
    expect(fetchSpy).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('rejects public links that redirect to private addresses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', {
        status: 302,
        headers: { location: 'http://192.168.1.20/admin' },
      })),
    )

    const result = await validateAssignmentSubmissionArtifactValue({
      type: 'link',
      url: 'https://student-demo.example',
    })

    expect(result).toEqual({
      validation_status: 'invalid',
      validation_message: 'Enter a public URL that does not resolve to a private or local address.',
      metadata_json: {},
      normalized_url: null,
    })

    vi.unstubAllGlobals()
  })
})

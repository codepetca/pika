import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getGitHubIdentityValidationFromArtifact,
  isBlockedPublicLinkHostname,
  normalizeGitHubLogin,
  normalizePublicUrl,
  validateAssignmentSubmissionArtifactValue,
} from '@/lib/server/assignment-submission-validation'

const dnsMocks = vi.hoisted(() => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}))

const requestMocks = vi.hoisted(() => ({
  httpRequest: vi.fn(),
  httpsRequest: vi.fn(),
}))

vi.mock('node:dns/promises', () => ({
  lookup: dnsMocks.lookup,
  default: {
    lookup: dnsMocks.lookup,
  },
}))

vi.mock('node:http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:http')>()
  return {
    ...actual,
    default: {
      ...actual,
      request: requestMocks.httpRequest,
    },
    request: requestMocks.httpRequest,
  }
})

vi.mock('node:https', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:https')>()
  return {
    ...actual,
    default: {
      ...actual,
      request: requestMocks.httpsRequest,
    },
    request: requestMocks.httpsRequest,
  }
})

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

function mockBoundedHttpResponse(opts: {
  status?: number
  body?: string
  location?: string
  transport?: 'http' | 'https'
} = {}) {
  const {
    status = 200,
    body = '<title>Student Project</title>',
    location,
    transport = 'https',
  } = opts
  const requestMock = transport === 'http' ? requestMocks.httpRequest : requestMocks.httpsRequest

  requestMock.mockImplementationOnce((_options, callback) => {
    const request = new EventEmitter() as EventEmitter & {
      end: ReturnType<typeof vi.fn>
      destroy: ReturnType<typeof vi.fn>
    }
    request.end = vi.fn(() => {
      const response = new EventEmitter() as EventEmitter & {
        statusCode: number
        headers: Record<string, string>
        resume: ReturnType<typeof vi.fn>
        destroy: ReturnType<typeof vi.fn>
      }
      response.statusCode = status
      response.headers = location ? { location } : {}
      response.resume = vi.fn(() => {
        process.nextTick(() => response.emit('end'))
        return response
      })
      response.destroy = vi.fn()

      process.nextTick(() => {
        callback(response)
        if (status < 300 || status >= 400) {
          response.emit('data', Buffer.from(body))
        }
        response.emit('end')
      })
    })
    request.destroy = vi.fn((error?: Error) => {
      if (error) process.nextTick(() => request.emit('error', error))
    })
    return request
  })
}

describe('assignment submission validation helpers', () => {
  beforeEach(() => {
    dnsMocks.lookup.mockReset()
    dnsMocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    requestMocks.httpRequest.mockReset()
    requestMocks.httpsRequest.mockReset()
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
      github_login_validation_status: 'valid',
      github_login_validation_message: null,
    })

    vi.unstubAllGlobals()
  })

  it('keeps account GitHub identity inaccessible when username verification cannot complete', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))

    const result = await validateAssignmentSubmissionArtifactValue({
      type: 'repo_link',
      url: 'https://github.com/codepetca/pika',
      githubLogin: '@student-dev',
    })

    expect(result.validation_status).toBe('valid')
    expect(result.github_login_validation_status).toBe('inaccessible')
    expect(getGitHubIdentityValidationFromArtifact(result)).toEqual({
      validation_status: 'inaccessible',
      validation_message: 'Pika could not verify this GitHub username right now.',
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
      metadata_json: {
        validation: 'format_only',
        validation_level: 'format_only',
      },
      normalized_url: 'https://example.com/missing',
    })
    expect(fetchSpy).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('verifies reachable links when the teacher asks for a page check', async () => {
    dnsMocks.lookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    mockBoundedHttpResponse()

    const result = await validateAssignmentSubmissionArtifactValue({
      type: 'link',
      url: 'https://example.com/project',
      validationPolicy: { mode: 'reachable' },
    })

    expect(result.validation_status).toBe('valid')
    expect(result.validation_message).toBeNull()
    expect(result.metadata_json).toMatchObject({
      validation: 'reachable',
      validation_level: 'verified',
      final_url: 'https://example.com/project',
      checked_host: 'example.com',
      http_status: 200,
      page_title: 'Student Project',
    })

    expect(requestMocks.httpsRequest).toHaveBeenCalledWith(expect.objectContaining({
      hostname: '93.184.216.34',
      servername: 'example.com',
      family: 4,
      headers: expect.objectContaining({
        Host: 'example.com',
      }),
    }), expect.any(Function))
  })

  it('flags expected-domain links when the final host does not match', async () => {
    const result = await validateAssignmentSubmissionArtifactValue({
      type: 'link',
      url: 'https://example.com/project',
      validationPolicy: {
        mode: 'expected_domain',
        expected_domains: ['codehs.com'],
      },
    })

    expect(result).toMatchObject({
      validation_status: 'invalid',
      validation_message: 'Link must point to codehs.com.',
      normalized_url: 'https://example.com/project',
    })
    expect(requestMocks.httpsRequest).not.toHaveBeenCalled()
  })

  it('marks unreachable policy-checked links for teacher review instead of blocking as inaccessible', async () => {
    dnsMocks.lookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    mockBoundedHttpResponse({
      status: 404,
      body: 'Not found',
    })

    const result = await validateAssignmentSubmissionArtifactValue({
      type: 'link',
      url: 'https://example.com/missing',
      validationPolicy: { mode: 'reachable' },
    })

    expect(result.validation_status).toBe('warning')
    expect(result.validation_message).toBe('Page returned HTTP 404.')
    expect(result.metadata_json).toMatchObject({
      validation: 'reachable',
      validation_level: 'review',
      http_status: 404,
    })
  })

  it('does not fetch policy-checked links that resolve to private addresses', async () => {
    dnsMocks.lookup.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }])

    const result = await validateAssignmentSubmissionArtifactValue({
      type: 'link',
      url: 'https://internal.example.com/project',
      validationPolicy: { mode: 'reachable' },
    })

    expect(result.validation_status).toBe('warning')
    expect(result.validation_message).toBe('Enter a public http or https URL.')
    expect(requestMocks.httpsRequest).not.toHaveBeenCalled()
  })
})

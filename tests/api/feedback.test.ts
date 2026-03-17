import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/feedback/route'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => ({
    id: 'user-1',
    role: 'teacher',
  })),
}))

describe('POST /api/feedback', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    global.fetch = vi.fn() as any
  })

  afterAll(() => {
    global.fetch = originalFetch
  })

  it('returns 501 when github feedback is not configured', async () => {
    const response = await POST(
      new Request('http://localhost:3000/api/feedback', {
        method: 'POST',
        body: JSON.stringify({
          category: 'bug',
          description: 'The feedback drawer does not open.',
          metadata: {},
        }),
      })
    )

    expect(response.status).toBe(501)
    await expect(response.json()).resolves.toEqual({ error: 'Feedback not configured' })
  })

  it('returns 400 for invalid request bodies', async () => {
    vi.stubEnv('GITHUB_FEEDBACK_TOKEN', 'token')
    vi.stubEnv('GITHUB_FEEDBACK_REPO', 'owner/repo')

    const response = await POST(
      new Request('http://localhost:3000/api/feedback', {
        method: 'POST',
        body: '{invalid',
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' })
  })

  it('returns 400 for invalid category and short descriptions', async () => {
    vi.stubEnv('GITHUB_FEEDBACK_TOKEN', 'token')
    vi.stubEnv('GITHUB_FEEDBACK_REPO', 'owner/repo')

    const invalidCategory = await POST(
      new Request('http://localhost:3000/api/feedback', {
        method: 'POST',
        body: JSON.stringify({
          category: 'praise',
          description: 'This is a long enough description.',
          metadata: {},
        }),
      })
    )

    expect(invalidCategory.status).toBe(400)
    await expect(invalidCategory.json()).resolves.toEqual({ error: 'Invalid category' })

    const shortDescription = await POST(
      new Request('http://localhost:3000/api/feedback', {
        method: 'POST',
        body: JSON.stringify({
          category: 'bug',
          description: 'Too short',
          metadata: {},
        }),
      })
    )

    expect(shortDescription.status).toBe(400)
    await expect(shortDescription.json()).resolves.toEqual({
      error: 'Description must be at least 10 characters',
    })
  })

  it('returns 502 when the github api request fails', async () => {
    vi.stubEnv('GITHUB_FEEDBACK_TOKEN', 'token')
    vi.stubEnv('GITHUB_FEEDBACK_REPO', 'owner/repo')
    ;(global.fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('upstream failure'),
    })

    const response = await POST(
      new Request('http://localhost:3000/api/feedback', {
        method: 'POST',
        body: JSON.stringify({
          category: 'bug',
          description: 'The feedback drawer does not open after save.',
          metadata: {
            url: 'http://localhost:3000/classrooms',
            userAgent: 'Vitest',
            version: '1.0.0',
            commit: 'abc123',
            env: 'test',
          },
        }),
      })
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to create feedback issue' })
  })

  it('creates a github issue with the authenticated user role and metadata', async () => {
    vi.stubEnv('GITHUB_FEEDBACK_TOKEN', 'token')
    vi.stubEnv('GITHUB_FEEDBACK_REPO', 'owner/repo')
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      status: 201,
      text: vi.fn(),
    })

    const response = await POST(
      new Request('http://localhost:3000/api/feedback', {
        method: 'POST',
        body: JSON.stringify({
          category: 'suggestion',
          description: 'Allow teachers to pin important assignment feedback.',
          metadata: {
            url: 'http://localhost:3000/classrooms/1?tab=assignments',
            userAgent: 'Vitest',
            version: '1.0.0',
            commit: 'abc123',
            env: 'test',
          },
        }),
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/issues',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        }),
      })
    )

    const fetchCall = vi.mocked(global.fetch).mock.calls[0]
    const body = JSON.parse(String(fetchCall[1]?.body))

    expect(body.title).toBe('[suggestion] Allow teachers to pin important assignment feedback.')
    expect(body.labels).toEqual(['user-feedback'])
    expect(body.body).toContain('**Role:** teacher')
    expect(body.body).toContain('http://localhost:3000/classrooms/1?tab=assignments')
    expect(body.body).toContain('Allow teachers to pin important assignment feedback.')
  })
})

import { describe, expect, it, vi } from 'vitest'

import { createPikaPalClient, getPalReadToken } from '@/integrations/pal/pal-client'

const NOW = Date.parse('2026-08-01T15:00:00.000Z')

function tokenResponse(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    token: 'learner-scoped-token',
    expires_at: '2026-08-01T15:05:00.000Z',
    ...overrides,
  }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Pika Pal learner client', () => {
  it('obtains only a short-lived token from the student same-origin route', async () => {
    const fetchImplementation = vi.fn(async () => tokenResponse())

    await expect(getPalReadToken(undefined, {
      fetchImplementation: fetchImplementation as typeof fetch,
      now: () => NOW,
    })).resolves.toBe('learner-scoped-token')

    expect(fetchImplementation).toHaveBeenCalledWith(
      '/api/student/pal/read-token',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
      }),
    )
    const request = fetchImplementation.mock.calls[0]
    expect(JSON.stringify(request)).not.toContain('student-')
    expect(JSON.stringify(request)).not.toContain('integration-secret')
  })

  it.each([
    null,
    {},
    { token: '', expires_at: '2026-08-01T15:05:00.000Z' },
    { token: 'token', expires_at: 'not-a-date' },
    { token: 'token', expires_at: '2026-08-01T14:59:59.000Z' },
    { token: 'token', expires_at: '2026-08-01T15:11:00.000Z' },
  ])('rejects malformed, expired, or overlong-lived token responses: %j', async (body) => {
    const fetchImplementation = vi.fn(async () => new Response(JSON.stringify(body)))
    await expect(getPalReadToken(undefined, {
      fetchImplementation: fetchImplementation as typeof fetch,
      now: () => NOW,
    })).rejects.toThrow(/Pal token/)
  })

  it('passes one abort signal through token and Pal snapshot requests', async () => {
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/api/student/pal/read-token') return tokenResponse()
      return new Response(JSON.stringify({}), { status: 503 })
    })
    const client = createPikaPalClient('https://pal.example.test', {
      fetchImplementation: fetchImplementation as typeof fetch,
      now: () => NOW,
    })
    const controller = new AbortController()

    await expect(client.getSnapshot(controller.signal)).rejects.toThrow()
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      1,
      '/api/student/pal/read-token',
      expect.objectContaining({ signal: controller.signal }),
    )
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      'https://pal.example.test/api/v1/learner/snapshot',
      expect.objectContaining({
        cache: 'no-store',
        signal: controller.signal,
      }),
    )
  })
})

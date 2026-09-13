import { describe, expect, it, vi } from 'vitest'
import { createFixtureSnapshot } from '@codepet/pal-widget'

import {
  createPalReadTokenProvider,
  createPikaPalClient,
  getPalReadToken,
} from '@/integrations/pal/pal-client'

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
  it('rechecks membership with Pika even while the earlier token is unexpired', async () => {
    const onRevoked = vi.fn()
    const fetchImplementation = vi.fn()
      .mockImplementationOnce(async () => tokenResponse({ scope_key: 'scope-a' }))
      .mockImplementationOnce(async () => new Response(JSON.stringify(createFixtureSnapshot())))
      .mockImplementationOnce(async () => new Response('{}', { status: 403 }))
    const client = createPikaPalClient('https://pal.example.test', { fetchImplementation, now: () => NOW,
      membership: { classroomId: 'a', scopeKey: 'scope-a' }, onRevoked })
    await client.getSnapshot()
    await expect(client.getSnapshot()).rejects.toThrow()
    expect(fetchImplementation.mock.calls.map(call => call[0])).toEqual([
      '/api/student/pal/read-token', 'https://pal.example.test/api/v1/learner/snapshot', '/api/student/pal/read-token',
    ])
    expect(onRevoked).toHaveBeenCalledOnce()
  })

  it('invalidates a cached token and rejects a late mint without an abort signal', async () => {
    let release: (response: Response) => void = () => undefined
    const fetchImplementation = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve }))
      .mockImplementation(async () => tokenResponse())
    const getToken = createPalReadTokenProvider({ fetchImplementation, now: () => NOW })
    const pending = getToken()
    const rejected = expect(pending).rejects.toThrow(/invalidated/)
    getToken.invalidate()
    release(tokenResponse())
    await rejected
    await expect(getToken()).resolves.toBe('learner-scoped-token')
    getToken.invalidate()
    await getToken()
    expect(fetchImplementation).toHaveBeenCalledTimes(3)
  })

  it.each([401, 403, 404, 410])('clears denied membership state on HTTP %s and rejects late responses without affecting another classroom', async status => {
    const snapshot = createFixtureSnapshot()
    let release: (value: unknown) => void = () => undefined
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/api/student/pal/read-token') {
        const scope = JSON.parse(String(init?.body)).scopeKey
        return tokenResponse({ scope_key: scope })
      }
      if (String(input).endsWith('/seen')) return new Response('{}', { status })
      const response = new Response('{}')
      response.json = () => new Promise(resolve => { release = resolve })
      return response
    })
    const onRevoked = vi.fn()
    const client = createPikaPalClient('https://pal.example.test', { fetchImplementation, now: () => NOW,
      membership: { classroomId: 'a', scopeKey: 'scope-a' }, onRevoked })
    const pending = client.getSnapshot()
    const rejected = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(2))
    await expect(client.markRewardSeen('reward-a')).rejects.toThrow()
    expect(onRevoked).toHaveBeenCalledOnce()
    release(snapshot)
    await rejected
    const calls = fetchImplementation.mock.calls.length
    await expect(client.getSnapshot()).rejects.toThrow(/access ended/)
    expect(fetchImplementation).toHaveBeenCalledTimes(calls)
    const other = createPalReadTokenProvider({ membership: { classroomId: 'b', scopeKey: 'scope-b' },
      fetchImplementation, now: () => NOW })
    await expect(other()).resolves.toBe('learner-scoped-token')
  })

  it('binds the token request and response to the resolved membership scope', async () => {
    const membership = { classroomId: 'classroom-a', scopeKey: 'scope-a' }
    const fetchImplementation = vi.fn(async () => tokenResponse({ scope_key: 'scope-a' }))
    const getToken = createPalReadTokenProvider({ membership, fetchImplementation, now: () => NOW })
    await expect(getToken()).resolves.toBe('learner-scoped-token')
    expect(fetchImplementation).toHaveBeenCalledWith('/api/student/pal/read-token',
      expect.objectContaining({ body: JSON.stringify(membership) }))
    const wrongScope = createPalReadTokenProvider({ membership: { ...membership, scopeKey: 'scope-b' },
      fetchImplementation, now: () => NOW })
    await expect(wrongScope()).rejects.toThrow(/scope/)
  })

  it('discards a previous classroom request when its provider aborts', async () => {
    const lifetime = new AbortController()
    const fetchImplementation = vi.fn(async () => tokenResponse({ scope_key: 'scope-a' }))
    const getToken = createPalReadTokenProvider({ membership: { classroomId: 'a', scopeKey: 'scope-a' },
      fetchImplementation, now: () => NOW })
    await getToken(lifetime.signal)
    lifetime.abort()
    await expect(getToken(lifetime.signal)).rejects.toThrow()
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
  })

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

  it('caches a token until its expires_at refresh buffer begins', async () => {
    let now = NOW
    const fetchImplementation = vi.fn(async () => tokenResponse())
    const getAccessToken = createPalReadTokenProvider({
      fetchImplementation: fetchImplementation as typeof fetch,
      now: () => now,
    })

    await expect(getAccessToken()).resolves.toBe('learner-scoped-token')
    now += 4 * 60 * 1000
    await expect(getAccessToken()).resolves.toBe('learner-scoped-token')
    expect(fetchImplementation).toHaveBeenCalledTimes(1)

    now += 31 * 1000
    await expect(getAccessToken()).resolves.toBe('learner-scoped-token')
    expect(fetchImplementation).toHaveBeenCalledTimes(2)
  })

  it('does not return a cached token to an already-aborted scope request', async () => {
    const fetchImplementation = vi.fn(async () => tokenResponse())
    const getAccessToken = createPalReadTokenProvider({
      fetchImplementation: fetchImplementation as typeof fetch,
      now: () => NOW,
    })
    await getAccessToken()

    const controller = new AbortController()
    controller.abort()
    await expect(getAccessToken(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
  })
})

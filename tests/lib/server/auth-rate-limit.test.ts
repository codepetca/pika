import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-handler'
import {
  clearAuthRateLimit,
  consumeAuthRateLimit,
  consumeAuthRequestRateLimits,
  getAuthClientFingerprint,
  hashAuthRateLimitKey,
} from '@/lib/server/auth-rate-limit'

function createClient(results: Array<{ data: unknown; error: unknown }>) {
  return {
    rpc: vi.fn().mockImplementation(() => Promise.resolve(results.shift())),
  }
}

describe('authentication rate limits', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('HMACs normalized account identifiers without storing the email', () => {
    vi.stubEnv('SESSION_SECRET', 'session-secret-that-is-at-least-32-characters')

    const normalized = hashAuthRateLimitKey('login_identifier', ' Student@Example.com ')
    expect(normalized).toBe(hashAuthRateLimitKey('login_identifier', 'student@example.com'))
    expect(normalized).toMatch(/^[0-9a-f]{64}$/)
    expect(normalized).not.toContain('student@example.com')
    expect(normalized).not.toBe(hashAuthRateLimitKey('reset_code_identifier', 'student@example.com'))
  })

  it('consumes an atomic database-backed attempt', async () => {
    vi.stubEnv('SESSION_SECRET', 'session-secret-that-is-at-least-32-characters')
    const client = createClient([{ data: { ok: true }, error: null }])

    await consumeAuthRateLimit({
      scope: 'login_identifier',
      value: 'student@example.com',
      maxAttempts: 10,
      windowSeconds: 900,
      supabase: client as never,
    })

    expect(client.rpc).toHaveBeenCalledWith('consume_auth_rate_limit', {
      p_scope: 'login_identifier',
      p_key_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      p_max_attempts: 10,
      p_window_seconds: 900,
    })
  })

  it('returns 429 for an exhausted window and fails closed on database errors', async () => {
    vi.stubEnv('SESSION_SECRET', 'session-secret-that-is-at-least-32-characters')
    const limited = createClient([{
      data: { ok: false, retry_after_seconds: 120 },
      error: null,
    }])
    await expect(consumeAuthRateLimit({
      scope: 'login_identifier', value: 'student@example.com', maxAttempts: 10,
      windowSeconds: 900, supabase: limited as never,
    })).rejects.toMatchObject({ statusCode: 429 })

    const unavailable = createClient([{ data: null, error: { message: 'unavailable' } }])
    await expect(consumeAuthRateLimit({
      scope: 'login_identifier', value: 'student@example.com', maxAttempts: 10,
      windowSeconds: 900, supabase: unavailable as never,
    })).rejects.toMatchObject({ statusCode: 503 })
  })

  it('clears the exact HMAC scope and rejects an unavailable reset', async () => {
    vi.stubEnv('SESSION_SECRET', 'session-secret-that-is-at-least-32-characters')
    const client = createClient([{ data: true, error: null }])
    await clearAuthRateLimit({
      scope: 'login_identifier', value: 'student@example.com', supabase: client as never,
    })
    expect(client.rpc).toHaveBeenCalledWith('clear_auth_rate_limit', {
      p_scope: 'login_identifier',
      p_key_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    })

    const failed = createClient([{ data: false, error: null }])
    await expect(clearAuthRateLimit({
      scope: 'login_identifier', value: 'student@example.com', supabase: failed as never,
    })).rejects.toBeInstanceOf(ApiError)
  })

  it('uses Vercel-overwritten client IPs in production and rejects spoofable fallbacks', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(getAuthClientFingerprint(new Request('https://pika.example/login', {
      headers: {
        'x-vercel-forwarded-for': '203.0.113.10',
        'x-forwarded-for': '198.51.100.4',
      },
    }))).toBe('ip:203.0.113.10')
    expect(getAuthClientFingerprint(new Request('https://pika.example/login', {
      headers: { 'x-forwarded-for': '198.51.100.4' },
    }))).toBe('unresolved-client')
  })

  it('charges client, overload, and identifier budgets in upstream-first order', async () => {
    vi.stubEnv('SESSION_SECRET', 'session-secret-that-is-at-least-32-characters')
    vi.stubEnv('NODE_ENV', 'production')
    const client = createClient([
      { data: { ok: true }, error: null },
      { data: { ok: true }, error: null },
      { data: { ok: true }, error: null },
    ])

    await consumeAuthRequestRateLimits({
      action: 'login',
      request: new Request('https://pika.example/login', {
        headers: { 'x-vercel-forwarded-for': '203.0.113.10' },
      }),
      identifier: 'first.student@example.com',
      identifierMaxAttempts: 10,
      clientMaxAttempts: 60,
      windowSeconds: 900,
      supabase: client as never,
    })

    expect(client.rpc.mock.calls.map((call: unknown[]) => [
      call[0],
      (call[1] as { p_scope?: string }).p_scope,
    ])).toEqual([
      ['consume_auth_rate_limit', 'login_client'],
      ['consume_auth_global_rate_limit', undefined],
      ['consume_auth_rate_limit', 'login_identifier'],
    ])
    expect(client.rpc).toHaveBeenNthCalledWith(2, 'consume_auth_global_rate_limit', {
      p_key_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      p_max_attempts: 10_000,
      p_window_seconds: 60,
    })
  })

  it('shares client and global budgets when one client rotates account identifiers', async () => {
    vi.stubEnv('SESSION_SECRET', 'session-secret-that-is-at-least-32-characters')
    vi.stubEnv('NODE_ENV', 'production')
    const client = createClient(Array.from({ length: 6 }, () => ({
      data: { ok: true },
      error: null,
    })))
    const request = new Request('https://pika.example/login', {
      headers: { 'x-vercel-forwarded-for': '203.0.113.10' },
    })

    for (const identifier of ['first@example.com', 'second@example.com']) {
      await consumeAuthRequestRateLimits({
        action: 'login',
        request,
        identifier,
        identifierMaxAttempts: 10,
        clientMaxAttempts: 60,
        windowSeconds: 900,
        supabase: client as never,
      })
    }

    const keys = client.rpc.mock.calls.map(
      (call: unknown[]) => (call[1] as { p_key_hash: string }).p_key_hash,
    )
    expect(keys[0]).toBe(keys[3])
    expect(keys[1]).toBe(keys[4])
    expect(keys[2]).not.toBe(keys[5])
  })

  it('does not charge overload or victim identifier budgets after client denial', async () => {
    vi.stubEnv('SESSION_SECRET', 'session-secret-that-is-at-least-32-characters')
    vi.stubEnv('NODE_ENV', 'production')
    const client = createClient([{
      data: { ok: false, retry_after_seconds: 120 },
      error: null,
    }])

    await expect(consumeAuthRequestRateLimits({
      action: 'login',
      request: new Request('https://pika.example/login', {
        headers: { 'x-vercel-forwarded-for': '203.0.113.10' },
      }),
      identifier: 'victim@example.com',
      identifierMaxAttempts: 10,
      clientMaxAttempts: 60,
      windowSeconds: 900,
      supabase: client as never,
    })).rejects.toMatchObject({ statusCode: 429 })

    expect(client.rpc).toHaveBeenCalledTimes(1)
    expect(client.rpc).toHaveBeenCalledWith('consume_auth_rate_limit', expect.objectContaining({
      p_scope: 'login_client',
    }))
  })

  it('does not charge a victim identifier budget after overload denial', async () => {
    vi.stubEnv('SESSION_SECRET', 'session-secret-that-is-at-least-32-characters')
    vi.stubEnv('NODE_ENV', 'production')
    const client = createClient([
      { data: { ok: true }, error: null },
      { data: { ok: false, retry_after_seconds: 30 }, error: null },
    ])

    await expect(consumeAuthRequestRateLimits({
      action: 'login',
      request: new Request('https://pika.example/login', {
        headers: { 'x-vercel-forwarded-for': '203.0.113.10' },
      }),
      identifier: 'victim@example.com',
      identifierMaxAttempts: 10,
      clientMaxAttempts: 60,
      windowSeconds: 900,
      supabase: client as never,
    })).rejects.toMatchObject({ statusCode: 429 })

    expect(client.rpc).toHaveBeenCalledTimes(2)
    expect(client.rpc).toHaveBeenNthCalledWith(
      2,
      'consume_auth_global_rate_limit',
      expect.any(Object),
    )
  })
})

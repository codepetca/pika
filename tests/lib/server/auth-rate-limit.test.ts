import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-handler'
import {
  clearAuthRateLimit,
  consumeAuthRateLimit,
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

    const normalized = hashAuthRateLimitKey('login', ' Student@Example.com ')
    expect(normalized).toBe(hashAuthRateLimitKey('login', 'student@example.com'))
    expect(normalized).toMatch(/^[0-9a-f]{64}$/)
    expect(normalized).not.toContain('student@example.com')
    expect(normalized).not.toBe(hashAuthRateLimitKey('reset_code', 'student@example.com'))
  })

  it('consumes an atomic database-backed attempt', async () => {
    vi.stubEnv('SESSION_SECRET', 'session-secret-that-is-at-least-32-characters')
    const client = createClient([{ data: { ok: true }, error: null }])

    await consumeAuthRateLimit({
      scope: 'login',
      value: 'student@example.com',
      maxAttempts: 10,
      windowSeconds: 900,
      supabase: client as never,
    })

    expect(client.rpc).toHaveBeenCalledWith('consume_auth_rate_limit', {
      p_scope: 'login',
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
      scope: 'login', value: 'student@example.com', maxAttempts: 10,
      windowSeconds: 900, supabase: limited as never,
    })).rejects.toMatchObject({ statusCode: 429 })

    const unavailable = createClient([{ data: null, error: { message: 'unavailable' } }])
    await expect(consumeAuthRateLimit({
      scope: 'login', value: 'student@example.com', maxAttempts: 10,
      windowSeconds: 900, supabase: unavailable as never,
    })).rejects.toMatchObject({ statusCode: 503 })
  })

  it('clears the exact HMAC scope and rejects an unavailable reset', async () => {
    vi.stubEnv('SESSION_SECRET', 'session-secret-that-is-at-least-32-characters')
    const client = createClient([{ data: true, error: null }])
    await clearAuthRateLimit({
      scope: 'login', value: 'student@example.com', supabase: client as never,
    })
    expect(client.rpc).toHaveBeenCalledWith('clear_auth_rate_limit', {
      p_scope: 'login',
      p_key_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    })

    const failed = createClient([{ data: false, error: null }])
    await expect(clearAuthRateLimit({
      scope: 'login', value: 'student@example.com', supabase: failed as never,
    })).rejects.toBeInstanceOf(ApiError)
  })
})

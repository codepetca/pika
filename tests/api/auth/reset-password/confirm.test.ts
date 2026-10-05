import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const HANDOFF = 'reset-handoff-token-abcdefghijklmnopqrstuvwxyz1234567890'
const generationMocks = vi.hoisted(() => ({ inspectLatestAuthHandoff: vi.fn(), consumeLatestPasswordReset: vi.fn() }))
const rateLimitMocks = vi.hoisted(() => ({ consumeAuthRequestRateLimits: vi.fn() }))
const authMocks = vi.hoisted(() => ({ createSession: vi.fn(async () => {}), AuthenticationError: class extends Error {}, AuthorizationError: class extends Error {} }))
const cryptoMocks = vi.hoisted(() => ({ hashPassword: vi.fn(async (password: string) => `hash_${password}`) }))
const mockSupabaseClient = { from: vi.fn(), rpc: vi.fn() }
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => mockSupabaseClient }))
vi.mock('@/lib/server/auth-rate-limit', () => rateLimitMocks)
vi.mock('@/lib/server/auth-verification-generation', () => generationMocks)
vi.mock('@/lib/auth', () => authMocks)
vi.mock('@/lib/crypto', () => ({ hashHandoffToken: (token: string) => `hashed_${token}`, hashPassword: cryptoMocks.hashPassword }))

import { POST } from '@/app/api/auth/reset-password/confirm/route'
import { ApiError } from '@/lib/api-handler'

const body = { email: 'user@example.com', password: 'Password123', passwordConfirmation: 'Password123', handoffToken: HANDOFF }
const request = (
  headers: Record<string, string> = { 'content-type': 'application/json' },
  payload: Record<string, unknown> = body,
) => new NextRequest('http://localhost:3000/api/auth/reset-password/confirm', {
  method: 'POST', headers, body: JSON.stringify(payload),
})
const validHandoff = { user_id: '10000000-0000-4000-8000-000000000001', email: 'user@example.com', role: 'student', generation: 4, credential_version: 3, email_verified: true, password_set: true }

describe('POST /api/auth/reset-password/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitMocks.consumeAuthRequestRateLimits.mockResolvedValue(undefined)
    generationMocks.inspectLatestAuthHandoff.mockResolvedValue({ handoff: validHandoff, error: null })
    generationMocks.consumeLatestPasswordReset.mockResolvedValue({ credentialVersion: 4, error: null })
  })

  for (const [headers, status] of [
    [{ 'content-type': 'text/plain', origin: 'https://other.example', 'sec-fetch-site': 'cross-site' }, 403],
    [{ 'content-type': 'application/json', origin: 'https://other.example' }, 403],
    [{ 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, 403],
    [{ 'content-type': 'text/plain', origin: 'http://localhost:3000' }, 415],
  ] as const) it(`rejects unsafe password-session metadata with ${status}`, async () => {
    expect((await POST(request(headers))).status).toBe(status)
    expect(generationMocks.inspectLatestAuthHandoff).not.toHaveBeenCalled()
    expect(cryptoMocks.hashPassword).not.toHaveBeenCalled()
  })

  for (const [name, payload] of [
    ['malformed email', { ...body, email: 'invalid' }],
    ['missing handoff', { email: body.email, password: body.password, passwordConfirmation: body.password }],
    ['mismatched confirmation', { ...body, passwordConfirmation: 'DifferentPassword' }],
  ] as const) it(`rejects ${name} before auth work`, async () => {
    expect((await POST(request(undefined, payload))).status).toBe(400)
    expect(rateLimitMocks.consumeAuthRequestRateLimits).not.toHaveBeenCalled()
    expect(generationMocks.inspectLatestAuthHandoff).not.toHaveBeenCalled()
    expect(cryptoMocks.hashPassword).not.toHaveBeenCalled()
    expect(authMocks.createSession).not.toHaveBeenCalled()
  })

  it('applies the confirmation limiter before handoff or password work', async () => {
    rateLimitMocks.consumeAuthRequestRateLimits.mockRejectedValueOnce(new ApiError(429, 'slow down'))
    expect((await POST(request())).status).toBe(429)
    expect(generationMocks.inspectLatestAuthHandoff).not.toHaveBeenCalled()
    expect(generationMocks.consumeLatestPasswordReset).not.toHaveBeenCalled()
    expect(cryptoMocks.hashPassword).not.toHaveBeenCalled()
    expect(authMocks.createSession).not.toHaveBeenCalled()
  })

  it('rejects a stale handoff before password hashing', async () => {
    generationMocks.inspectLatestAuthHandoff.mockResolvedValue({ handoff: null, error: null })
    expect((await POST(request())).status).toBe(401)
    expect(cryptoMocks.hashPassword).not.toHaveBeenCalled()
  })

  it('atomically resets the password and uses the returned credential epoch', async () => {
    expect((await POST(request())).status).toBe(200)
    expect(generationMocks.consumeLatestPasswordReset).toHaveBeenCalledWith(mockSupabaseClient, {
      userId: validHandoff.user_id, generation: 4, handoffTokenHash: `hashed_${HANDOFF}`, passwordHash: 'hash_Password123',
    })
    expect(authMocks.createSession).toHaveBeenCalledWith(validHandoff.user_id, 'user@example.com', 'student', { expectedCredentialVersion: 4 })
  })

  it('does not create a session when a newer generation wins during hashing', async () => {
    generationMocks.consumeLatestPasswordReset.mockResolvedValue({ credentialVersion: null, error: null })
    expect((await POST(request())).status).toBe(401)
    expect(authMocks.createSession).not.toHaveBeenCalled()
  })

  it('fails closed when the migration RPC is unavailable', async () => {
    generationMocks.consumeLatestPasswordReset.mockResolvedValue({ credentialVersion: null, error: { message: 'missing rpc' } })
    expect((await POST(request())).status).toBe(500)
    expect(authMocks.createSession).not.toHaveBeenCalled()
  })
})

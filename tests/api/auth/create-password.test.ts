import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const HANDOFF = 'handoff-token-abcdefghijklmnopqrstuvwxyz1234567890'
const generationMocks = vi.hoisted(() => ({ inspectLatestAuthHandoff: vi.fn(), consumeSignupPasswordHandoff: vi.fn() }))
const rateLimitMocks = vi.hoisted(() => ({ consumeAuthRequestRateLimits: vi.fn() }))
const authMocks = vi.hoisted(() => ({ createSession: vi.fn(async () => {}) }))
const cryptoMocks = vi.hoisted(() => ({ hashPassword: vi.fn(async (password: string) => `hash_${password}`) }))
const mockSupabaseClient = { from: vi.fn() }
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => mockSupabaseClient }))
vi.mock('@/lib/server/auth-rate-limit', () => rateLimitMocks)
vi.mock('@/lib/server/auth-verification-generation', () => generationMocks)
vi.mock('@/lib/auth', () => authMocks)
vi.mock('@/lib/crypto', () => ({ hashHandoffToken: (token: string) => `hashed_${token}`, hashPassword: cryptoMocks.hashPassword, validatePassword: () => null }))

import { POST } from '@/app/api/auth/create-password/route'

const body = { email: 'user@example.com', password: 'Password123', passwordConfirmation: 'Password123', handoffToken: HANDOFF }
const request = (headers: Record<string, string> = { 'content-type': 'application/json' }) => new NextRequest('http://localhost:3000/api/auth/create-password', { method: 'POST', headers, body: JSON.stringify(body) })
const validHandoff = { user_id: '10000000-0000-4000-8000-000000000001', email: 'user@example.com', role: 'student', generation: 2, credential_version: 1, email_verified: true, password_set: false }

describe('POST /api/auth/create-password', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitMocks.consumeAuthRequestRateLimits.mockResolvedValue(undefined)
    generationMocks.inspectLatestAuthHandoff.mockResolvedValue({ handoff: validHandoff, error: null })
    generationMocks.consumeSignupPasswordHandoff.mockResolvedValue({ credentialVersion: 1, error: null })
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

  it('rejects a stale handoff before password hashing', async () => {
    generationMocks.inspectLatestAuthHandoff.mockResolvedValue({ handoff: null, error: null })
    expect((await POST(request())).status).toBe(401)
    expect(cryptoMocks.hashPassword).not.toHaveBeenCalled()
  })

  it('atomically consumes the observed generation before creating a session', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(generationMocks.consumeSignupPasswordHandoff).toHaveBeenCalledWith(mockSupabaseClient, {
      userId: validHandoff.user_id, generation: 2, handoffTokenHash: `hashed_${HANDOFF}`,
      passwordHash: 'hash_Password123', expectedCredentialVersion: 1,
    })
    expect(authMocks.createSession).toHaveBeenCalledWith(validHandoff.user_id, 'user@example.com', 'student', { expectedCredentialVersion: 1 })
  })

  it('does not create a session when a resend or sibling winner invalidates the handoff during hashing', async () => {
    generationMocks.consumeSignupPasswordHandoff.mockResolvedValue({ credentialVersion: null, error: null })
    expect((await POST(request())).status).toBe(401)
    expect(authMocks.createSession).not.toHaveBeenCalled()
  })

  it('fails closed when the migration RPC is unavailable', async () => {
    generationMocks.inspectLatestAuthHandoff.mockResolvedValue({ handoff: null, error: { message: 'missing rpc' } })
    expect((await POST(request())).status).toBe(500)
    expect(cryptoMocks.hashPassword).not.toHaveBeenCalled()
  })
})

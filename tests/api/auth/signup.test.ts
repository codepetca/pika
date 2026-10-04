import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const rateLimitMocks = vi.hoisted(() => ({ consumeAuthRequestRateLimits: vi.fn() }))
const responseMocks = vi.hoisted(() => ({
  completeAuthResponseFloor: vi.fn(async () => {}),
  scheduleSignupCode: vi.fn(),
}))
const generationMocks = vi.hoisted(() => ({ issueAuthVerificationCode: vi.fn() }))
const mockSupabaseClient = { from: vi.fn() }

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => mockSupabaseClient }))
vi.mock('@/lib/crypto', () => ({
  generateVerificationCode: () => 'ABC12',
  hashCode: vi.fn(async () => '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ12345'),
}))
vi.mock('@/lib/server/auth-response', () => responseMocks)
vi.mock('@/lib/server/auth-rate-limit', () => rateLimitMocks)
vi.mock('@/lib/server/auth-verification-generation', () => generationMocks)
vi.mock('@/lib/auth', () => ({ isTeacherEmail: (email: string) => email.endsWith('@yrdsb.ca') }))

import { POST } from '@/app/api/auth/signup/route'
import { ApiError } from '@/lib/api-handler'

function request(email: unknown) {
  return new NextRequest('http://localhost:3000/api/auth/signup', {
    method: 'POST', body: JSON.stringify({ email }),
  })
}

function userLookup(data: unknown, error: unknown = null, insertRole?: (role: string) => void) {
  mockSupabaseClient.from.mockImplementation((table: string) => {
    expect(table).toBe('users')
    return {
      select: () => ({ eq: () => ({ single: async () => ({ data, error }) }) }),
      insert: (value: { role: string }) => {
        insertRole?.(value.role)
        return { select: () => ({ single: async () => ({ data: { id: '10000000-0000-4000-8000-000000000001' }, error: null }) }) }
      },
    }
  })
}

describe('POST /api/auth/signup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitMocks.consumeAuthRequestRateLimits.mockResolvedValue(undefined)
    generationMocks.issueAuthVerificationCode.mockResolvedValue({ result: { ok: true }, error: null })
  })

  it('validates the email', async () => {
    expect((await POST(request('bad'))).status).toBe(400)
  })

  it('creates a teacher then issues through the generation-fenced RPC seam', async () => {
    let role = ''
    userLookup(null, { code: 'PGRST116' }, value => { role = value })
    const response = await POST(request('teacher@yrdsb.ca'))
    expect(response.status).toBe(200)
    expect(role).toBe('teacher')
    expect(generationMocks.issueAuthVerificationCode).toHaveBeenCalledWith(mockSupabaseClient, expect.objectContaining({
      userId: '10000000-0000-4000-8000-000000000001', purpose: 'signup',
      codeHash: expect.stringMatching(/^\$2b\$/), expiresAt: expect.any(String),
    }))
    expect(responseMocks.scheduleSignupCode).toHaveBeenCalledWith('teacher@yrdsb.ca', 'ABC12')
  })

  it('does not issue or send for an account that already has a password', async () => {
    userLookup({ id: '10000000-0000-4000-8000-000000000001', password_hash: 'existing' })
    expect((await POST(request('user@example.com'))).status).toBe(200)
    expect(generationMocks.issueAuthVerificationCode).not.toHaveBeenCalled()
    expect(responseMocks.scheduleSignupCode).not.toHaveBeenCalled()
  })

  it('keeps generic success when locked issuance becomes ineligible', async () => {
    userLookup({ id: '10000000-0000-4000-8000-000000000001', password_hash: null })
    generationMocks.issueAuthVerificationCode.mockResolvedValue({ result: { ok: false }, error: null })
    expect((await POST(request('user@example.com'))).status).toBe(200)
    expect(responseMocks.scheduleSignupCode).not.toHaveBeenCalled()
  })

  it('fails closed when the generation RPC is unavailable', async () => {
    userLookup({ id: '10000000-0000-4000-8000-000000000001', password_hash: null })
    generationMocks.issueAuthVerificationCode.mockResolvedValue({ result: null, error: { message: 'missing rpc' } })
    expect((await POST(request('user@example.com'))).status).toBe(500)
    expect(responseMocks.scheduleSignupCode).not.toHaveBeenCalled()
  })

  it('applies the issuance rate limit before account lookup', async () => {
    rateLimitMocks.consumeAuthRequestRateLimits.mockRejectedValue(new ApiError(429, 'slow down'))
    expect((await POST(request('user@example.com'))).status).toBe(429)
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })
})

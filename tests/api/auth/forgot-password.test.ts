import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const rateLimitMocks = vi.hoisted(() => ({ consumeAuthRequestRateLimits: vi.fn() }))
const responseMocks = vi.hoisted(() => ({ completeAuthResponseFloor: vi.fn(async () => {}), schedulePasswordResetCode: vi.fn() }))
const generationMocks = vi.hoisted(() => ({ issueAuthVerificationCode: vi.fn() }))
const mockSupabaseClient = { from: vi.fn() }
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => mockSupabaseClient }))
vi.mock('@/lib/crypto', () => ({ generateVerificationCode: () => 'ABC12', hashCode: vi.fn(async () => '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ12345') }))
vi.mock('@/lib/server/auth-response', () => responseMocks)
vi.mock('@/lib/server/auth-rate-limit', () => rateLimitMocks)
vi.mock('@/lib/server/auth-verification-generation', () => generationMocks)

import { POST } from '@/app/api/auth/forgot-password/route'
import { ApiError } from '@/lib/api-handler'

const request = () => new NextRequest('http://localhost:3000/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: 'user@example.com' }) })
function lookup(data: unknown) {
  mockSupabaseClient.from.mockReturnValue({ select: () => ({ eq: () => ({ single: async () => ({ data, error: null }) }) }) })
}

describe('POST /api/auth/forgot-password', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitMocks.consumeAuthRequestRateLimits.mockResolvedValue(undefined)
    generationMocks.issueAuthVerificationCode.mockResolvedValue({ result: { ok: true }, error: null })
  })

  it('keeps a generic response for a missing account', async () => {
    lookup(null)
    expect((await POST(request())).status).toBe(200)
    expect(generationMocks.issueAuthVerificationCode).not.toHaveBeenCalled()
    expect(responseMocks.schedulePasswordResetCode).not.toHaveBeenCalled()
  })

  it('issues a reset generation and schedules delivery for an eligible account', async () => {
    lookup({ id: '10000000-0000-4000-8000-000000000001', password_hash: 'existing' })
    expect((await POST(request())).status).toBe(200)
    expect(generationMocks.issueAuthVerificationCode).toHaveBeenCalledWith(mockSupabaseClient, expect.objectContaining({ purpose: 'reset_password' }))
    expect(responseMocks.schedulePasswordResetCode).toHaveBeenCalledWith('user@example.com', 'ABC12')
  })

  it('does not deliver when locked issuance reports an ineligible account', async () => {
    lookup({ id: '10000000-0000-4000-8000-000000000001', password_hash: 'existing' })
    generationMocks.issueAuthVerificationCode.mockResolvedValue({ result: { ok: false }, error: null })
    expect((await POST(request())).status).toBe(200)
    expect(responseMocks.schedulePasswordResetCode).not.toHaveBeenCalled()
  })

  it('does not expose a generation RPC failure', async () => {
    lookup({ id: '10000000-0000-4000-8000-000000000001', password_hash: 'existing' })
    generationMocks.issueAuthVerificationCode.mockResolvedValue({ result: null, error: { message: 'missing rpc' } })
    expect((await POST(request())).status).toBe(200)
    expect(responseMocks.schedulePasswordResetCode).not.toHaveBeenCalled()
  })

  it('keeps the generic response when throttled', async () => {
    rateLimitMocks.consumeAuthRequestRateLimits.mockRejectedValue(new ApiError(429, 'slow down'))
    expect((await POST(request())).status).toBe(200)
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })
})

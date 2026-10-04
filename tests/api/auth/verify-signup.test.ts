import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const generationMocks = vi.hoisted(() => ({ verifyAuthCodeAndIssueHandoff: vi.fn() }))
const rateLimitMocks = vi.hoisted(() => ({ consumeAuthRequestRateLimits: vi.fn() }))
const mockSupabaseClient = { from: vi.fn() }
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => mockSupabaseClient }))
vi.mock('@/lib/server/auth-rate-limit', () => rateLimitMocks)
vi.mock('@/lib/server/auth-verification-generation', () => generationMocks)

import { POST } from '@/app/api/auth/verify-signup/route'

const request = (body: Record<string, unknown>) => new NextRequest('http://localhost:3000/api/auth/verify-signup', { method: 'POST', body: JSON.stringify(body) })
function lookup(data: unknown, error: unknown = null) {
  mockSupabaseClient.from.mockReturnValue({ select: () => ({ eq: () => ({ single: async () => ({ data, error }) }) }) })
}

describe('POST /api/auth/verify-signup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitMocks.consumeAuthRequestRateLimits.mockResolvedValue(undefined)
    generationMocks.verifyAuthCodeAndIssueHandoff.mockResolvedValue({ error: null, handoffToken: null })
  })

  it('validates required fields', async () => {
    expect((await POST(request({ email: 'user@example.com' }))).status).toBe(400)
  })

  it('does dummy-equivalent verification for a missing user and returns generic 401', async () => {
    lookup(null, { code: 'PGRST116' })
    const response = await POST(request({ email: 'user@example.com', code: 'ABC12' }))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Invalid email or code' })
    expect(generationMocks.verifyAuthCodeAndIssueHandoff).toHaveBeenCalledWith(mockSupabaseClient, expect.objectContaining({
      userId: '00000000-0000-0000-0000-000000000000', purpose: 'signup', code: 'ABC12',
    }))
  })

  it('rejects an existing password account even if a handoff seam is mocked successful', async () => {
    lookup({ id: '10000000-0000-4000-8000-000000000001', password_hash: 'existing' })
    generationMocks.verifyAuthCodeAndIssueHandoff.mockResolvedValue({ error: null, handoffToken: 'opaque' })
    expect((await POST(request({ email: 'user@example.com', code: 'ABC12' }))).status).toBe(401)
  })

  it('returns the fenced handoff for an eligible account', async () => {
    lookup({ id: '10000000-0000-4000-8000-000000000001', password_hash: null })
    generationMocks.verifyAuthCodeAndIssueHandoff.mockResolvedValue({ error: null, handoffToken: 'signup-handoff' })
    const response = await POST(request({ email: 'user@example.com', code: 'ABC12' }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ userId: '10000000-0000-4000-8000-000000000001', handoffToken: 'signup-handoff' })
  })

  it('fails closed when the finalization RPC is unavailable', async () => {
    lookup({ id: '10000000-0000-4000-8000-000000000001', password_hash: null })
    generationMocks.verifyAuthCodeAndIssueHandoff.mockResolvedValue({ error: { message: 'missing rpc' }, handoffToken: null })
    expect((await POST(request({ email: 'user@example.com', code: 'ABC12' }))).status).toBe(500)
  })
})

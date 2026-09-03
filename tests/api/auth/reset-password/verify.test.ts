/**
 * API tests for POST /api/auth/reset-password/verify
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/auth/reset-password/verify/route'
import { NextRequest } from 'next/server'

const rateLimitMocks = vi.hoisted(() => ({ consumeAuthRequestRateLimits: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/crypto', () => ({
  verifyCode: vi.fn(async (code: string, hash: string) => code === 'ABC12' && hash === 'hashed_ABC12'),
  generateHandoffToken: vi.fn(() => 'reset-handoff-token-abcdefghijklmnopqrstuvwxyz1234567890'),
  hashHandoffToken: vi.fn((token: string) => `hashed_${token}`),
}))
vi.mock('@/lib/server/auth-rate-limit', () => rateLimitMocks)

vi.mock('@/lib/auth', () => ({
  AuthenticationError: class AuthenticationError extends Error {
    constructor(message: string) { super(message); this.name = 'AuthenticationError' }
  },
  AuthorizationError: class AuthorizationError extends Error {
    constructor(message: string) { super(message); this.name = 'AuthorizationError' }
  },
}))

const mockSupabaseClient = { from: vi.fn() }
const noopVerificationUpdate = () => vi.fn(() => ({
  eq: vi.fn().mockResolvedValue({ error: null }),
}))

describe('POST /api/auth/reset-password/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitMocks.consumeAuthRequestRateLimits.mockResolvedValue(undefined)
  })

  it('should return 400 for missing required fields', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/reset-password/verify', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('code')
  })

  it('should return 401 when no codes exist', async () => {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'users') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'user-1', email: 'test@example.com', password_hash: 'hash' },
                error: null,
              }),
            })),
          })),
        }
      } else if (table === 'verification_codes') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            gt: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
          update: noopVerificationUpdate(),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/auth/reset-password/verify', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', code: 'ABC12' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid email or code' })
  })

  it('returns a byte-identical failure for missing, inactive, and wrong-code states', async () => {
    const sentinelCodeId = '00000000-0000-0000-0000-000000000001'
    const states = [
      { user: null, codes: [], expectedUpdateId: sentinelCodeId },
      {
        user: { id: 'user-1', email: 'test@example.com', password_hash: 'hash' },
        codes: [],
        expectedUpdateId: sentinelCodeId,
      },
      {
        user: { id: 'user-1', email: 'test@example.com', password_hash: 'hash' },
        codes: [{ id: 'code-1', code_hash: 'different_hash', attempts: 0 }],
        expectedUpdateId: 'code-1',
      },
      {
        user: { id: 'user-1', email: 'test@example.com', password_hash: 'hash' },
        codes: [{ id: 'code-exhausted', code_hash: 'different_hash', attempts: 5 }],
        expectedUpdateId: sentinelCodeId,
      },
    ]
    const bodies: string[] = []

    for (const state of states) {
      const failureUpdateEq = vi.fn().mockResolvedValue({ error: null })
      const failureUpdate = vi.fn(() => ({ eq: failureUpdateEq }))
      mockSupabaseClient.from = vi.fn((table: string) => {
        if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: state.user,
                  error: state.user ? null : { code: 'PGRST116' },
                }),
              })),
            })),
          }
        }
        const lookup: any = {
          eq: vi.fn(() => lookup),
          is: vi.fn(() => lookup),
          gt: vi.fn(() => lookup),
          order: vi.fn().mockResolvedValue({ data: state.codes, error: null }),
        }
        return {
          select: vi.fn(() => lookup),
          update: failureUpdate,
        }
      }) as never

      const response = await POST(new NextRequest(
        'http://localhost:3000/api/auth/reset-password/verify',
        {
          method: 'POST',
          body: JSON.stringify({ email: 'test@example.com', code: 'ABC12' }),
        },
      ))
      expect(response.status).toBe(401)
      bodies.push(await response.text())
      expect(failureUpdate).toHaveBeenCalledTimes(1)
      expect(failureUpdateEq).toHaveBeenCalledWith('id', state.expectedUpdateId)
    }

    expect(new Set(bodies)).toEqual(new Set(['{"error":"Invalid email or code"}']))
  })

  it('should verify code and issue a reset handoff token', async () => {
    const codeUpdateBuilder: any = {
      eq: vi.fn(() => codeUpdateBuilder),
      is: vi.fn(() => codeUpdateBuilder),
      select: vi.fn(() => codeUpdateBuilder),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'code-1' }, error: null }),
    }
    const codeUpdate = vi.fn(() => codeUpdateBuilder)

    const mockFrom = vi.fn((table: string) => {
      if (table === 'users') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'user-1', email: 'test@example.com', password_hash: 'hash' },
                error: null,
              }),
            })),
          })),
        }
      } else if (table === 'verification_codes') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            gt: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [{
                id: 'code-1',
                code_hash: 'hashed_ABC12',
                attempts: 0,
              }],
              error: null,
            }),
          })),
          update: codeUpdate,
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/auth/reset-password/verify', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', code: 'ABC12' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.userId).toBe('user-1')
    expect(data.handoffToken).toBe('reset-handoff-token-abcdefghijklmnopqrstuvwxyz1234567890')
    expect(codeUpdate).toHaveBeenCalledWith(expect.objectContaining({
      used_at: expect.any(String),
      handoff_token_hash: 'hashed_reset-handoff-token-abcdefghijklmnopqrstuvwxyz1234567890',
      handoff_expires_at: expect.any(String),
      handoff_consumed_at: null,
    }))
  })
})

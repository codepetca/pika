/**
 * API tests for POST /api/auth/reset-password/verify
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/auth/reset-password/verify/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/crypto', () => ({
  verifyCode: vi.fn(async (code: string, hash: string) => code === 'ABC12' && hash === 'hashed_ABC12'),
  generateHandoffToken: vi.fn(() => 'reset-handoff-token-abcdefghijklmnopqrstuvwxyz1234567890'),
  hashHandoffToken: vi.fn((token: string) => `hashed_${token}`),
}))

vi.mock('@/lib/auth', () => ({
  AuthenticationError: class AuthenticationError extends Error {
    constructor(message: string) { super(message); this.name = 'AuthenticationError' }
  },
  AuthorizationError: class AuthorizationError extends Error {
    constructor(message: string) { super(message); this.name = 'AuthorizationError' }
  },
}))

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/auth/reset-password/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
                data: { id: 'user-1', email: 'test@example.com' },
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
                data: { id: 'user-1', email: 'test@example.com' },
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

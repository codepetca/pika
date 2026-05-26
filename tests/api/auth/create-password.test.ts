/**
 * API tests for POST /api/auth/create-password
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/auth/create-password/route'
import { NextRequest } from 'next/server'

const VALID_HANDOFF_TOKEN = 'handoff-token-abcdefghijklmnopqrstuvwxyz1234567890'

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/crypto', () => ({
  hashPassword: vi.fn(async (pwd: string) => `hashed_${pwd}`),
  hashHandoffToken: vi.fn((token: string) => `hashed_${token}`),
  validatePassword: vi.fn(() => null),
}))

vi.mock('@/lib/auth', () => ({
  createSession: vi.fn(async () => {}),
}))

const mockSupabaseClient = { from: vi.fn() }

function createRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/auth/create-password', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    email: 'test@example.com',
    password: 'Password123',
    passwordConfirmation: 'Password123',
    handoffToken: VALID_HANDOFF_TOKEN,
    ...overrides,
  }
}

function chainableUpdate(result: { data?: unknown; error: unknown }) {
  const builder: any = {
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    gt: vi.fn(() => builder),
    select: vi.fn(() => builder),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
  return builder
}

describe('POST /api/auth/create-password', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 400 when passwords do not match', async () => {
    const response = await POST(createRequest(validBody({
      passwordConfirmation: 'DifferentPassword',
    })))

    expect(response.status).toBe(400)
  })

  it('should return 400 when handoff token is missing', async () => {
    const response = await POST(createRequest({
      email: 'test@example.com',
      password: 'Password123',
      passwordConfirmation: 'Password123',
    }))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('Verification session is required')
  })

  it('should return 400 when user already has password', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'user-1',
              email: 'test@example.com',
              password_hash: 'existing_hash',
              email_verified_at: new Date().toISOString(),
            },
            error: null,
          }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const response = await POST(createRequest(validBody()))

    expect(response.status).toBe(400)
  })

  it('should return 400 when email is not verified', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'user-1',
              email: 'test@example.com',
              password_hash: null,
              email_verified_at: null,
            },
            error: null,
          }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const response = await POST(createRequest(validBody()))

    expect(response.status).toBe(400)
  })

  it('should reject an invalid, expired, or reused handoff token', async () => {
    const userUpdate = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }))

    const mockFrom = vi.fn((table: string) => {
      if (table === 'users') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'user-1',
                  email: 'test@example.com',
                  role: 'student',
                  password_hash: null,
                  email_verified_at: new Date().toISOString(),
                },
                error: null,
              }),
            })),
          })),
          update: userUpdate,
        }
      }

      if (table === 'verification_codes') {
        return {
          update: vi.fn(() => chainableUpdate({ data: null, error: null })),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const response = await POST(createRequest(validBody()))
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Verification session expired. Please verify your email again.')
    expect(userUpdate).not.toHaveBeenCalled()
  })

  it('should create password for verified user with valid handoff token', async () => {
    const userUpdate = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }))

    const consumeBuilder = chainableUpdate({
      data: { id: 'code-1' },
      error: null,
    })

    const mockFrom = vi.fn((table: string) => {
      if (table === 'users') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'user-1',
                  email: 'test@example.com',
                  role: 'student',
                  password_hash: null,
                  email_verified_at: new Date().toISOString(),
                },
                error: null,
              }),
            })),
          })),
          update: userUpdate,
        }
      }

      if (table === 'verification_codes') {
        return {
          update: vi.fn(() => consumeBuilder),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const response = await POST(createRequest(validBody()))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.redirectUrl).toBe('/classrooms')
    expect(consumeBuilder.eq).toHaveBeenCalledWith('purpose', 'signup')
    expect(consumeBuilder.eq).toHaveBeenCalledWith('handoff_token_hash', `hashed_${VALID_HANDOFF_TOKEN}`)
    expect(userUpdate).toHaveBeenCalledWith({ password_hash: 'hashed_Password123' })
  })
})

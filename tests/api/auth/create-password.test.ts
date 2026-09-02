/**
 * API tests for POST /api/auth/create-password
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/auth/create-password/route'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-handler'

const VALID_HANDOFF_TOKEN = 'handoff-token-abcdefghijklmnopqrstuvwxyz1234567890'
const rateLimitMocks = vi.hoisted(() => ({ consumeAuthRequestRateLimits: vi.fn() }))

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
vi.mock('@/lib/server/auth-rate-limit', () => rateLimitMocks)

import { createSession } from '@/lib/auth'

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
    rateLimitMocks.consumeAuthRequestRateLimits.mockResolvedValue(undefined)
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

  it('applies signup confirmation limits before any database lookup', async () => {
    rateLimitMocks.consumeAuthRequestRateLimits.mockRejectedValueOnce(
      new ApiError(429, 'Too many attempts. Please try again later.'),
    )

    const response = await POST(createRequest(validBody()))

    expect(response.status).toBe(429)
    expect(rateLimitMocks.consumeAuthRequestRateLimits).toHaveBeenCalledWith({
      action: 'signup_confirm',
      request: expect.any(NextRequest),
      identifier: 'test@example.com',
      identifierMaxAttempts: 5,
      clientMaxAttempts: 30,
      windowSeconds: 600,
      supabase: mockSupabaseClient,
    })
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })

  it('returns a generic 401 when the account already has a password', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'user-1',
              email: 'test@example.com',
              password_hash: 'existing_hash',
              email_verified_at: new Date().toISOString(),
              auth_credential_version: 1,
            },
            error: null,
          }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const response = await POST(createRequest(validBody()))

    expect(response.status).toBe(401)
  })

  it('returns a generic 401 when the email is not verified', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'user-1',
              email: 'test@example.com',
              password_hash: null,
              email_verified_at: null,
              auth_credential_version: 1,
            },
            error: null,
          }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const response = await POST(createRequest(validBody()))

    expect(response.status).toBe(401)
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
                  auth_credential_version: 1,
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
                  auth_credential_version: 1,
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
    expect(createSession).toHaveBeenCalledWith(
      'user-1',
      'test@example.com',
      'student',
      { expectedCredentialVersion: 1 },
    )
  })
})

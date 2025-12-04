/**
 * API tests for POST /api/auth/create-password
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/auth/create-password/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/crypto', () => ({
  hashPassword: vi.fn(async (pwd: string) => `hashed_${pwd}`),
  validatePassword: vi.fn(() => null),
}))

vi.mock('@/lib/auth', () => ({
  createSession: vi.fn(async () => {}),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/auth/create-password', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 400 when passwords do not match', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/create-password', {
      method: 'POST',
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'Password123',
        passwordConfirmation: 'DifferentPassword',
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
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

    const request = new NextRequest('http://localhost:3000/api/auth/create-password', {
      method: 'POST',
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'Password123',
        passwordConfirmation: 'Password123',
      }),
    })

    const response = await POST(request)
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

    const request = new NextRequest('http://localhost:3000/api/auth/create-password', {
      method: 'POST',
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'Password123',
        passwordConfirmation: 'Password123',
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('should create password for verified user', async () => {
    const mockFrom = vi.fn(() => ({
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
      update: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/auth/create-password', {
      method: 'POST',
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'Password123',
        passwordConfirmation: 'Password123',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.redirectUrl).toBe('/student/today')
  })
})

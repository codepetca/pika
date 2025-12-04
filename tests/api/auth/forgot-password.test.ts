/**
 * API tests for POST /api/auth/forgot-password
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/auth/forgot-password/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/crypto', () => ({
  generateVerificationCode: vi.fn(() => 'ABC12'),
  hashCode: vi.fn(async (code: string) => `hashed_${code}`),
}))

vi.mock('@/lib/email', () => ({
  sendPasswordResetCode: vi.fn(async () => {}),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/auth/forgot-password', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return success even when user does not exist (prevent enumeration)', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'nonexistent@example.com' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
  })

  it('should return success when user has no password (prevent enumeration)', async () => {
    const mockFrom = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { id: 'user-1', email: 'test@example.com', password_hash: null },
            error: null,
          }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
  })

  it('should send reset code for valid user with password', async () => {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'users') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'user-1', email: 'test@example.com', password_hash: 'hashed_password' },
                error: null,
              }),
            })),
          })),
        }
      } else if (table === 'verification_codes') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
          insert: vi.fn().mockResolvedValue({ error: null }),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
  })
})

/**
 * API tests for POST /api/auth/reset-password/confirm
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/auth/reset-password/confirm/route'
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

describe('POST /api/auth/reset-password/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 401 when no recent reset code exists', async () => {
    const mockFrom = vi.fn((table: string) => {
      if (table === 'users') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'user-1', email: 'test@example.com', role: 'student' },
                error: null,
              }),
            })),
          })),
        }
      } else if (table === 'verification_codes') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
          })),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/auth/reset-password/confirm', {
      method: 'POST',
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'NewPassword123',
        passwordConfirmation: 'NewPassword123',
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(401)
  })

  it('should reset password with valid code session', async () => {
    const mockUpdate = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }))

    const mockFrom = vi.fn((table: string) => {
      if (table === 'users') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'user-1', email: 'test@example.com', role: 'student' },
                error: null,
              }),
            })),
          })),
          update: mockUpdate,
        }
      } else if (table === 'verification_codes') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'code-1', used_at: new Date().toISOString() },
                error: null,
              }),
            })),
          })),
        }
      }
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    const request = new NextRequest('http://localhost:3000/api/auth/reset-password/confirm', {
      method: 'POST',
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'NewPassword123',
        passwordConfirmation: 'NewPassword123',
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
  })
})

/**
 * API tests for POST /api/auth/verify-signup
 * Tests signup verification code validation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/auth/verify-signup/route'
import { NextRequest } from 'next/server'

// Mock modules
vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/crypto', () => ({
  verifyCode: vi.fn(async (code: string, hash: string) => code === 'ABC12' && hash === 'hashed_ABC12'),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/auth/verify-signup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('validation', () => {
    it('should return 400 when email is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/verify-signup', {
        method: 'POST',
        body: JSON.stringify({ code: 'ABC12' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Email and code are required')
    })

    it('should return 400 when code is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/verify-signup', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Email and code are required')
    })
  })

  describe('verification', () => {
    it('should return 401 when user does not exist', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/verify-signup', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', code: 'ABC12' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Invalid email or code')
    })

    it('should return 400 when user already has password', async () => {
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
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/verify-signup', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', code: 'ABC12' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('This account already has a password. Please login instead.')
    })

    it('should return 401 when no valid codes exist', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'user-1', email: 'test@example.com', password_hash: null },
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

      const request = new NextRequest('http://localhost:3000/api/auth/verify-signup', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', code: 'ABC12' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Invalid or expired code')
    })

    it('should verify code and mark email as verified', async () => {
      const mockUpdate = vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }))

      const mockFrom = vi.fn((table: string) => {
        if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'user-1', email: 'test@example.com', password_hash: null },
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
              is: vi.fn().mockReturnThis(),
              gt: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue({
                data: [{
                  id: 'code-1',
                  user_id: 'user-1',
                  code_hash: 'hashed_ABC12',
                  attempts: 0,
                  expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
                }],
                error: null,
              }),
            })),
            update: mockUpdate,
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/verify-signup', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', code: 'ABC12' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toMatchObject({
        success: true,
        message: 'Email verified successfully',
        userId: 'user-1',
      })
    })
  })
})

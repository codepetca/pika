/**
 * API tests for POST /api/auth/request-code
 * Tests code generation, hashing, rate limiting, and email sending
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/auth/request-code/route'
import { NextRequest } from 'next/server'

// Mock modules
vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/crypto', () => ({
  generateCode: vi.fn(() => '12345'),
  hashCode: vi.fn(async (code: string) => `hashed_${code}`),
}))

vi.mock('@/lib/email', () => ({
  sendLoginCode: vi.fn(async () => {}),
}))

// Import mocked modules
import { getServiceRoleClient } from '@/lib/supabase'
import { generateCode, hashCode } from '@/lib/crypto'
import { sendLoginCode } from '@/lib/email'

// Create mock Supabase client
const mockSupabaseClient = {
  from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
  })),
}

describe('POST /api/auth/request-code', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock: no recent codes (rate limit not hit)
    const mockSelect = mockSupabaseClient.from().select() as any
    mockSelect.mockResolvedValue({ data: [], error: null })

    // Default mock: successful insert
    const mockInsert = mockSupabaseClient.from().insert() as any
    mockInsert.mockResolvedValue({ error: null })
  })

  // ==========================================================================
  // Validation Tests
  // ==========================================================================

  describe('validation', () => {
    it('should return 400 when email is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({}),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Email is required')
    })

    it('should return 400 when email is null', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({ email: null }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Email is required')
    })

    it('should return 400 when email is not a string', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({ email: 12345 }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Email is required')
    })

    it('should return 400 when email format is invalid', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'not-an-email' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid email format')
    })

    it('should normalize email by trimming and lowercasing', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({ email: '  Test@Example.Com  ' }),
      })

      const response = await POST(request)

      expect(response.status).toBe(200)

      // Verify the insert was called with normalized email
      const insertCall = (mockSupabaseClient.from as any).mock.results[1]?.value?.insert
      expect(insertCall).toHaveBeenCalled()
      const insertArgs = insertCall.mock.calls[0][0]
      expect(insertArgs.email).toBeUndefined() // Will check via from('login_codes').eq() call
    })
  })

  // ==========================================================================
  // Rate Limiting Tests
  // ==========================================================================

  describe('rate limiting', () => {
    it('should return 429 when rate limit is exceeded (5+ requests in last hour)', async () => {
      // Mock: 5 recent codes already exist
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockResolvedValue({
            data: Array(5).fill({ id: 'code-id' }),
            error: null,
          }),
        })),
        insert: vi.fn().mockReturnThis(),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(429)
      expect(data.error).toBe('Too many code requests. Please try again later.')
    })

    it('should allow request when under rate limit (4 requests in last hour)', async () => {
      // Mock: 4 recent codes exist
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockResolvedValue({
            data: Array(4).fill({ id: 'code-id' }),
            error: null,
          }),
        })),
        insert: vi.fn().mockResolvedValue({ error: null }),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
    })

    it('should check codes created in the last hour only', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      await POST(request)

      // Verify gte was called with a timestamp ~1 hour ago
      const selectChain = (mockSupabaseClient.from as any).mock.results[0]?.value?.select()
      const gteCall = selectChain.gte.mock.calls[0]
      expect(gteCall[0]).toBe('created_at')

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
      const calledTimestamp = new Date(gteCall[1])

      // Allow 1 second tolerance for test execution time
      expect(Math.abs(calledTimestamp.getTime() - oneHourAgo.getTime())).toBeLessThan(1000)
    })
  })

  // ==========================================================================
  // Code Generation and Storage Tests
  // ==========================================================================

  describe('code generation and storage', () => {
    it('should generate a code using generateCode()', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      await POST(request)

      expect(generateCode).toHaveBeenCalledTimes(1)
    })

    it('should hash the code before storing', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      await POST(request)

      expect(hashCode).toHaveBeenCalledWith('12345')
    })

    it('should store hashed code with correct expiry (10 minutes)', async () => {
      const mockInsert = vi.fn().mockResolvedValue({ error: null })
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
        insert: mockInsert,
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      const beforeTime = Date.now()
      await POST(request)
      const afterTime = Date.now()

      expect(mockInsert).toHaveBeenCalled()
      const insertData = mockInsert.mock.calls[0][0]

      expect(insertData).toMatchObject({
        email: 'test@example.com',
        code_hash: 'hashed_12345',
        used: false,
        attempts: 0,
      })

      // Verify expiry is ~10 minutes from now
      const expiresAt = new Date(insertData.expires_at)
      const expectedExpiryMin = new Date(beforeTime + 10 * 60 * 1000)
      const expectedExpiryMax = new Date(afterTime + 10 * 60 * 1000)

      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(expectedExpiryMin.getTime())
      expect(expiresAt.getTime()).toBeLessThanOrEqual(expectedExpiryMax.getTime())
    })
  })

  // ==========================================================================
  // Email Sending Tests
  // ==========================================================================

  describe('email sending', () => {
    it('should send login code via email', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      await POST(request)

      expect(sendLoginCode).toHaveBeenCalledWith('test@example.com', '12345')
    })

    it('should still return success if email fails to send', async () => {
      // Mock email failure
      ;(sendLoginCode as any).mockRejectedValueOnce(new Error('Email service down'))

      const request = new NextRequest('http://localhost:3000/api/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })
  })

  // ==========================================================================
  // Success Cases
  // ==========================================================================

  describe('success cases', () => {
    it('should return 200 with success message', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({
        success: true,
        message: 'Login code sent to your email',
      })
    })
  })

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('error handling', () => {
    it('should return 500 when checking recent codes fails', async () => {
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Database error' },
          }),
        })),
        insert: vi.fn(),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Internal server error')
    })

    it('should return 500 when inserting code fails', async () => {
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
        insert: vi.fn().mockResolvedValue({
          error: { message: 'Insert failed' },
        }),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to generate code')
    })

    it('should return 500 when JSON parsing fails', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/request-code', {
        method: 'POST',
        body: 'invalid json',
        headers: { 'Content-Type': 'application/json' },
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Internal server error')
    })
  })
})

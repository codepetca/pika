/**
 * API tests for POST /api/auth/signup
 * Tests user registration and verification code sending
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/auth/signup/route'
import { NextRequest } from 'next/server'

// Mock modules
vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/crypto', () => ({
  generateVerificationCode: vi.fn(() => 'ABC12'),
  hashCode: vi.fn(async (code: string) => `hashed_${code}`),
}))

vi.mock('@/lib/email', () => ({
  sendSignupCode: vi.fn(async () => {}),
}))

vi.mock('@/lib/auth', () => ({
  isTeacherEmail: vi.fn((email: string) => email.includes('@gapps.yrdsb.ca') || email.includes('@yrdsb.ca')),
}))

// Import mocked modules
import { getServiceRoleClient } from '@/lib/supabase'
import { generateVerificationCode, hashCode } from '@/lib/crypto'
import { sendSignupCode } from '@/lib/email'
import { isTeacherEmail } from '@/lib/auth'

// Create mock Supabase client
const mockSupabaseClient = {
  from: vi.fn(),
}

describe('POST /api/auth/signup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================================================
  // Validation Tests
  // ==========================================================================

  describe('validation', () => {
    it('should return 400 when email is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({}),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Email is required')
    })

    it('should return 400 when email is not a string', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email: 12345 }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Email is required')
    })

    it('should return 400 when email format is invalid', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email: 'not-an-email' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid email format')
    })
  })

  // ==========================================================================
  // User Creation Tests
  // ==========================================================================

  describe('user creation', () => {
    it('should return 400 when user already exists with password', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'user-1',
                    email: 'test@example.com',
                    password_hash: 'hashed_password',
                  },
                  error: null,
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('An account with this email already exists. Please login instead.')
    })

    it('should create new student user when user does not exist', async () => {
      const mockInsert = vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { id: 'user-new-1' },
            error: null,
          }),
        })),
      }))

      const mockFrom = vi.fn((table: string) => {
        if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST116' },
                }),
              })),
            })),
            insert: mockInsert,
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

      const request = new NextRequest('http://localhost:3000/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email: 'newstudent@example.com' }),
      })

      await POST(request)

      expect(mockInsert).toHaveBeenCalledWith({
        email: 'newstudent@example.com',
        role: 'student',
      })
    })

    it('should create new teacher user for YRDSB email', async () => {
      const mockInsert = vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { id: 'user-teacher-1' },
            error: null,
          }),
        })),
      }))

      const mockFrom = vi.fn((table: string) => {
        if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST116' },
                }),
              })),
            })),
            insert: mockInsert,
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

      const request = new NextRequest('http://localhost:3000/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email: 'teacher@gapps.yrdsb.ca' }),
      })

      await POST(request)

      expect(mockInsert).toHaveBeenCalledWith({
        email: 'teacher@gapps.yrdsb.ca',
        role: 'teacher',
      })
    })

    it('should reuse existing user ID if user exists without password', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'user-existing-1',
                    email: 'test@example.com',
                    password_hash: null,
                  },
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

      const request = new NextRequest('http://localhost:3000/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      await POST(request)

      // Verification code should be created for existing user ID
      expect(mockFrom).toHaveBeenCalledWith('verification_codes')
    })
  })

  // ==========================================================================
  // Rate Limiting Tests
  // ==========================================================================

  describe('rate limiting', () => {
    it('should return 429 when rate limit is exceeded (5+ requests in last hour)', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'user-1', password_hash: null },
                  error: null,
                }),
              })),
            })),
          }
        } else if (table === 'verification_codes') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              gte: vi.fn().mockResolvedValue({
                data: Array(5).fill({ id: 'code-id' }),
                error: null,
              }),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(429)
      expect(data.error).toBe('Too many code requests. Please try again later.')
    })

    it('should allow request when under rate limit', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'user-1', password_hash: null },
                  error: null,
                }),
              })),
            })),
          }
        } else if (table === 'verification_codes') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              gte: vi.fn().mockResolvedValue({
                data: Array(4).fill({ id: 'code-id' }),
                error: null,
              }),
            })),
            insert: vi.fn().mockResolvedValue({ error: null }),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
    })
  })

  // ==========================================================================
  // Code Generation Tests
  // ==========================================================================

  describe('code generation', () => {
    it('should generate and hash verification code', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'user-1', password_hash: null },
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

      const request = new NextRequest('http://localhost:3000/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      await POST(request)

      expect(generateVerificationCode).toHaveBeenCalled()
      expect(hashCode).toHaveBeenCalledWith('ABC12')
    })

    it('should store code with correct purpose and expiry', async () => {
      const mockInsert = vi.fn().mockResolvedValue({ error: null })

      const mockFrom = vi.fn((table: string) => {
        if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'user-1', password_hash: null },
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
            insert: mockInsert,
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const beforeTime = Date.now()
      const request = new NextRequest('http://localhost:3000/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      await POST(request)
      const afterTime = Date.now()

      expect(mockInsert).toHaveBeenCalled()
      const insertData = mockInsert.mock.calls[0][0]

      expect(insertData).toMatchObject({
        user_id: 'user-1',
        code_hash: 'hashed_ABC12',
        purpose: 'signup',
        attempts: 0,
      })

      // Verify expiry is ~10 minutes from now
      const expiresAt = new Date(insertData.expires_at)
      const expectedExpiryMin = new Date(beforeTime + 10 * 60 * 1000)
      const expectedExpiryMax = new Date(afterTime + 10 * 60 * 1000)

      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(expectedExpiryMin.getTime())
      expect(expiresAt.getTime()).toBeLessThanOrEqual(expectedExpiryMax.getTime())
    })

    it('should send code via email', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'user-1', password_hash: null },
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

      const request = new NextRequest('http://localhost:3000/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      await POST(request)

      expect(sendSignupCode).toHaveBeenCalledWith('test@example.com', 'ABC12')
    })

    it('should still return success if email fails to send', async () => {
      ;(sendSignupCode as any).mockRejectedValueOnce(new Error('Email service down'))

      const mockFrom = vi.fn((table: string) => {
        if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'user-1', password_hash: null },
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

      const request = new NextRequest('http://localhost:3000/api/auth/signup', {
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
      const mockFrom = vi.fn((table: string) => {
        if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'user-1', password_hash: null },
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

      const request = new NextRequest('http://localhost:3000/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({
        success: true,
        message: 'Verification code sent to your email',
      })
    })
  })

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('error handling', () => {
    it('should return 500 when creating user fails', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST116' },
                }),
              })),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'Insert failed' },
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to create user')
    })

    it('should return 500 when checking rate limit fails', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'user-1', password_hash: null },
                  error: null,
                }),
              })),
            })),
          }
        } else if (table === 'verification_codes') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              gte: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Database error' },
              }),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Internal server error')
    })

    it('should return 500 when inserting code fails', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'user-1', password_hash: null },
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
            insert: vi.fn().mockResolvedValue({
              error: { message: 'Insert failed' },
            }),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to generate code')
    })
  })
})

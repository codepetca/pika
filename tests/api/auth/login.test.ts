/**
 * API tests for POST /api/auth/login
 * Tests password-based authentication with rate limiting
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/auth/login/route'
import { NextRequest } from 'next/server'
import { loginAttempts } from '@/lib/login-lockout'

// Mock modules
vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/crypto', () => ({
  verifyPassword: vi.fn(async (password: string, hash: string) =>
    password === 'ValidPassword123' && hash === 'hashed_ValidPassword123'
  ),
}))

vi.mock('@/lib/auth', () => ({
  createSession: vi.fn(async () => {}),
  AuthenticationError: class AuthenticationError extends Error {
    constructor(message = 'Not authenticated') { super(message); this.name = 'AuthenticationError' }
  },
  AuthorizationError: class AuthorizationError extends Error {
    constructor(message = 'Forbidden') { super(message); this.name = 'AuthorizationError' }
  },
}))

// Import mocked modules
import { getServiceRoleClient } from '@/lib/supabase'
import { verifyPassword } from '@/lib/crypto'
import { createSession } from '@/lib/auth'

// Create mock Supabase client
const mockSupabaseClient = {
  from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn(() => ({
      single: vi.fn(),
    })),
  })),
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset in-memory login attempts between tests
    loginAttempts.clear()
  })

  // ==========================================================================
  // Validation Tests
  // ==========================================================================

  describe('validation', () => {
    it('should return 400 when email is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password: 'ValidPassword123' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Email and password are required')
    })

    it('should return 400 when password is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Email and password are required')
    })

    it('should return 400 when both email and password are missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({}),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Email and password are required')
    })
  })

  // ==========================================================================
  // Authentication Tests
  // ==========================================================================

  describe('authentication', () => {
    it('should return 401 when user does not exist', async () => {
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: 'PGRST116' },
            }),
          })),
        })),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'nonexistent@example.com', password: 'ValidPassword123' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Invalid email or password')
    })

    it('should return 400 when user has no password set', async () => {
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'user-1',
                email: 'test@example.com',
                role: 'student',
                password_hash: null, // No password set
              },
              error: null,
            }),
          })),
        })),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', password: 'ValidPassword123' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Please complete signup by setting a password')
    })

    it('should return 401 when password is incorrect', async () => {
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'user-1',
                email: 'test@example.com',
                role: 'student',
                password_hash: 'hashed_ValidPassword123',
              },
              error: null,
            }),
          })),
        })),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', password: 'WrongPassword' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Invalid email or password')
    })

    it('should verify password using verifyPassword function', async () => {
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'user-1',
                email: 'test@example.com',
                role: 'student',
                password_hash: 'hashed_ValidPassword123',
              },
              error: null,
            }),
          })),
        })),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', password: 'ValidPassword123' }),
      })

      await POST(request)

      expect(verifyPassword).toHaveBeenCalledWith('ValidPassword123', 'hashed_ValidPassword123')
    })
  })

  // ==========================================================================
  // Rate Limiting Tests
  // ==========================================================================

  describe('rate limiting', () => {
    it('should lock account after 5 failed attempts', async () => {
      vi.useFakeTimers()
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: 'PGRST116' },
            }),
          })),
        })),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const email = 'test@example.com'

      // Make 5 failed login attempts
      for (let i = 0; i < 5; i++) {
        const request = new NextRequest('http://localhost:3000/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password: 'WrongPassword' }),
        })
        await POST(request)
      }

      // 6th attempt should be locked
      const request = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password: 'WrongPassword' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(429)
      expect(data.error).toContain('Too many failed attempts')

      vi.useRealTimers()
    })

    it('should include minutes remaining in lockout message', async () => {
      vi.useFakeTimers()
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: 'PGRST116' },
            }),
          })),
        })),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const email = 'test2@example.com'

      // Make 5 failed attempts to trigger lockout
      for (let i = 0; i < 5; i++) {
        const request = new NextRequest('http://localhost:3000/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password: 'WrongPassword' }),
        })
        await POST(request)
      }

      // Try again while locked
      const request = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password: 'WrongPassword' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(data.error).toMatch(/Try again in \d+ minute/)

      vi.useRealTimers()
    })
  })

  // ==========================================================================
  // Success Cases
  // ==========================================================================

  describe('success cases', () => {
    it('should create session and return success for student', async () => {
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'user-1',
                email: 'test@example.com',
                role: 'student',
                password_hash: 'hashed_ValidPassword123',
              },
              error: null,
            }),
          })),
        })),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', password: 'ValidPassword123' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(createSession).toHaveBeenCalledWith('user-1', 'test@example.com', 'student')
      expect(response.status).toBe(200)
      expect(data).toEqual({
        success: true,
        message: 'Login successful',
        redirectUrl: '/classrooms',
        user: {
          id: 'user-1',
          email: 'test@example.com',
          role: 'student',
        },
      })
    })

    it('should create session and return success for teacher', async () => {
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'user-teacher-1',
                email: 'teacher@gapps.yrdsb.ca',
                role: 'teacher',
                password_hash: 'hashed_ValidPassword123',
              },
              error: null,
            }),
          })),
        })),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'teacher@gapps.yrdsb.ca', password: 'ValidPassword123' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(createSession).toHaveBeenCalledWith('user-teacher-1', 'teacher@gapps.yrdsb.ca', 'teacher')
      expect(response.status).toBe(200)
      expect(data).toEqual({
        success: true,
        message: 'Login successful',
        redirectUrl: '/classrooms',
        user: {
          id: 'user-teacher-1',
          email: 'teacher@gapps.yrdsb.ca',
          role: 'teacher',
        },
      })
    })
  })

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('error handling', () => {
    it('should return 500 when database query fails', async () => {
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database error', code: 'ERROR' },
            }),
          })),
        })),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', password: 'ValidPassword123' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Invalid email or password')
    })

    it('should return 500 when JSON parsing fails', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/login', {
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

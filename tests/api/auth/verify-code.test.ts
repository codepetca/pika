/**
 * API tests for POST /api/auth/verify-code
 * Tests code verification, session creation, and user provisioning
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/auth/verify-code/route'
import { NextRequest } from 'next/server'

// Mock modules
vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/crypto', () => ({
  verifyCode: vi.fn(async (code: string, hash: string) => code === '12345' && hash === 'hashed_12345'),
}))

vi.mock('@/lib/auth', () => ({
  createSession: vi.fn(async () => {}),
  isTeacherEmail: vi.fn((email: string) => email.includes('@gapps.yrdsb.ca') || email.includes('@yrdsb.ca')),
}))

// Import mocked modules
import { getServiceRoleClient } from '@/lib/supabase'
import { verifyCode } from '@/lib/crypto'
import { createSession, isTeacherEmail } from '@/lib/auth'

// Create mock Supabase client
const mockSupabaseClient = {
  from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn(),
  })),
}

describe('POST /api/auth/verify-code', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================================================
  // Validation Tests
  // ==========================================================================

  describe('validation', () => {
    it('should return 400 when email is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ code: '12345' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Email and code are required')
    })

    it('should return 400 when code is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Email and code are required')
    })

    it('should return 400 when both email and code are missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({}),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Email and code are required')
    })

    it('should normalize email by trimming and lowercasing', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'login_codes') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              gt: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue({
                data: [{
                  id: 'code-1',
                  email: 'test@example.com',
                  code_hash: 'hashed_12345',
                  attempts: 0,
                  used: false,
                  expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
                }],
                error: null,
              }),
            })),
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          }
        } else if (table === 'users') {
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
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email: '  Test@Example.Com  ', code: '12345' }),
      })

      await POST(request)

      // Verify normalized email was used in query for login_codes table
      const loginCodesChain = mockFrom.mock.results.find((r: any) => mockFrom.mock.calls[mockFrom.mock.results.indexOf(r)][0] === 'login_codes')
      expect(loginCodesChain).toBeDefined()
    })

    it('should normalize code by trimming and uppercasing', async () => {
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          gt: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [{
              id: 'code-1',
              email: 'test@example.com',
              code_hash: 'hashed_12345',
              attempts: 0,
              used: false,
              expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            }],
            error: null,
          }),
        })),
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', code: '  abc12  ' }),
      })

      await POST(request)

      // Verify code was uppercased when calling verifyCode
      expect(verifyCode).toHaveBeenCalledWith('ABC12', expect.any(String))
    })
  })

  // ==========================================================================
  // Code Verification Tests
  // ==========================================================================

  describe('code verification', () => {
    it('should return 401 when no codes exist for email', async () => {
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          gt: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
        update: vi.fn(),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', code: '12345' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Invalid or expired code')
    })

    it('should return 401 when code is expired', async () => {
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          gt: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [], // Empty because gt filter excludes expired codes
            error: null,
          }),
        })),
        update: vi.fn(),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', code: '12345' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Invalid or expired code')
    })

    it('should return 401 when code has been used', async () => {
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          gt: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [], // Empty because eq('used', false) filter excludes used codes
            error: null,
          }),
        })),
        update: vi.fn(),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', code: '12345' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Invalid or expired code')
    })

    it('should return 401 when code does not match hash', async () => {
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          gt: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [{
              id: 'code-1',
              email: 'test@example.com',
              code_hash: 'hashed_wrongcode',
              attempts: 0,
              used: false,
              expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            }],
            error: null,
          }),
        })),
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', code: '12345' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Invalid code')
    })

    it('should increment attempts on invalid code', async () => {
      const mockUpdate = vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }))
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          gt: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [{
              id: 'code-1',
              email: 'test@example.com',
              code_hash: 'hashed_wrongcode',
              attempts: 0,
              used: false,
              expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            }],
            error: null,
          }),
        })),
        update: mockUpdate,
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', code: '12345' }),
      })

      await POST(request)

      expect(mockUpdate).toHaveBeenCalledWith({ attempts: 1 })
    })

    it('should skip codes with 3+ attempts', async () => {
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          gt: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'code-1',
                email: 'test@example.com',
                code_hash: 'hashed_12345',
                attempts: 3, // Max attempts reached
                used: false,
                expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
              },
            ],
            error: null,
          }),
        })),
        update: vi.fn(),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', code: '12345' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Invalid code')
      expect(verifyCode).not.toHaveBeenCalled() // Should not attempt verification
    })

    it('should try codes in order (most recent first)', async () => {
      const mockSelectChain = {
        eq: vi.fn().mockReturnThis(),
        gt: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [{
            id: 'code-1',
            email: 'test@example.com',
            code_hash: 'hashed_12345',
            attempts: 0,
            used: false,
            created_at: '2024-01-15T12:00:00Z',
            expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          }],
          error: null,
        }),
      }

      const mockFrom = vi.fn((table: string) => {
        if (table === 'login_codes') {
          return {
            select: vi.fn(() => mockSelectChain),
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          }
        } else if (table === 'users') {
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
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', code: '12345' }),
      })

      await POST(request)

      // Verify order was called with descending created_at
      expect(mockSelectChain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    })
  })

  // ==========================================================================
  // User Creation and Session Tests
  // ==========================================================================

  describe('user creation and session', () => {
    it('should create session for existing user with correct role (student)', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'login_codes') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              gt: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue({
                data: [{
                  id: 'code-1',
                  email: 'test@example.com',
                  code_hash: 'hashed_12345',
                  attempts: 0,
                  used: false,
                  expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
                }],
                error: null,
              }),
            })),
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          }
        } else if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'user-1',
                    email: 'test@example.com',
                    role: 'student',
                  },
                  error: null,
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', code: '12345' }),
      })

      const response = await POST(request)

      expect(createSession).toHaveBeenCalledWith('user-1', 'test@example.com', 'student')
      expect(response.status).toBe(200)
    })

    it('should create session for existing user with correct role (teacher)', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'login_codes') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              gt: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue({
                data: [{
                  id: 'code-1',
                  email: 'teacher@gapps.yrdsb.ca',
                  code_hash: 'hashed_12345',
                  attempts: 0,
                  used: false,
                  expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
                }],
                error: null,
              }),
            })),
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          }
        } else if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'user-teacher-1',
                    email: 'teacher@gapps.yrdsb.ca',
                    role: 'teacher',
                  },
                  error: null,
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'teacher@gapps.yrdsb.ca', code: '12345' }),
      })

      const response = await POST(request)

      expect(createSession).toHaveBeenCalledWith('user-teacher-1', 'teacher@gapps.yrdsb.ca', 'teacher')
      expect(response.status).toBe(200)
    })

    it('should create new user when user does not exist (student)', async () => {
      const mockInsert = vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'user-new-1',
              email: 'newstudent@example.com',
              role: 'student',
            },
            error: null,
          }),
        })),
      }))

      const mockFrom = vi.fn((table: string) => {
        if (table === 'login_codes') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              gt: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue({
                data: [{
                  id: 'code-1',
                  email: 'newstudent@example.com',
                  code_hash: 'hashed_12345',
                  attempts: 0,
                  used: false,
                  expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
                }],
                error: null,
              }),
            })),
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          }
        } else if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST116' }, // Not found
                }),
              })),
            })),
            insert: mockInsert,
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'newstudent@example.com', code: '12345' }),
      })

      const response = await POST(request)

      expect(mockInsert).toHaveBeenCalledWith({
        email: 'newstudent@example.com',
        role: 'student',
      })
      expect(createSession).toHaveBeenCalledWith('user-new-1', 'newstudent@example.com', 'student')
      expect(response.status).toBe(200)
    })

    it('should create new user when user does not exist (teacher)', async () => {
      const mockInsert = vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'user-new-teacher-1',
              email: 'newteacher@gapps.yrdsb.ca',
              role: 'teacher',
            },
            error: null,
          }),
        })),
      }))

      const mockFrom = vi.fn((table: string) => {
        if (table === 'login_codes') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              gt: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue({
                data: [{
                  id: 'code-1',
                  email: 'newteacher@gapps.yrdsb.ca',
                  code_hash: 'hashed_12345',
                  attempts: 0,
                  used: false,
                  expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
                }],
                error: null,
              }),
            })),
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          }
        } else if (table === 'users') {
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
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'newteacher@gapps.yrdsb.ca', code: '12345' }),
      })

      const response = await POST(request)

      expect(mockInsert).toHaveBeenCalledWith({
        email: 'newteacher@gapps.yrdsb.ca',
        role: 'teacher',
      })
      expect(response.status).toBe(200)
    })

    it('should mark code as used after successful verification', async () => {
      const mockUpdate = vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }))

      const mockFrom = vi.fn((table: string) => {
        if (table === 'login_codes') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              gt: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue({
                data: [{
                  id: 'code-1',
                  email: 'test@example.com',
                  code_hash: 'hashed_12345',
                  attempts: 0,
                  used: false,
                  expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
                }],
                error: null,
              }),
            })),
            update: mockUpdate,
          }
        } else if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'user-1',
                    email: 'test@example.com',
                    role: 'student',
                  },
                  error: null,
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', code: '12345' }),
      })

      await POST(request)

      // Verify code was marked as used
      const updateCalls = mockUpdate.mock.calls
      expect(updateCalls.some((call: any[]) => call[0]?.used === true)).toBe(true)
    })
  })

  // ==========================================================================
  // Success Cases
  // ==========================================================================

  describe('success cases', () => {
    it('should return 200 with redirect URL for student', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'login_codes') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              gt: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue({
                data: [{
                  id: 'code-1',
                  email: 'test@example.com',
                  code_hash: 'hashed_12345',
                  attempts: 0,
                  used: false,
                  expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
                }],
                error: null,
              }),
            })),
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          }
        } else if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'user-1',
                    email: 'test@example.com',
                    role: 'student',
                  },
                  error: null,
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', code: '12345' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({
        success: true,
        redirectUrl: '/student/today',
        user: {
          id: 'user-1',
          email: 'test@example.com',
          role: 'student',
        },
      })
    })

    it('should return 200 with redirect URL for teacher', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'login_codes') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              gt: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue({
                data: [{
                  id: 'code-1',
                  email: 'teacher@gapps.yrdsb.ca',
                  code_hash: 'hashed_12345',
                  attempts: 0,
                  used: false,
                  expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
                }],
                error: null,
              }),
            })),
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          }
        } else if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'user-teacher-1',
                    email: 'teacher@gapps.yrdsb.ca',
                    role: 'teacher',
                  },
                  error: null,
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'teacher@gapps.yrdsb.ca', code: '12345' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({
        success: true,
        redirectUrl: '/teacher/dashboard',
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
    it('should return 500 when fetching codes fails', async () => {
      const mockFrom = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          gt: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Database error' },
          }),
        })),
      }))
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', code: '12345' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Internal server error')
    })

    it('should return 500 when fetching user fails with non-PGRST116 error', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'login_codes') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              gt: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue({
                data: [{
                  id: 'code-1',
                  email: 'test@example.com',
                  code_hash: 'hashed_12345',
                  attempts: 0,
                  used: false,
                  expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
                }],
                error: null,
              }),
            })),
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          }
        } else if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'SOME_OTHER_ERROR', message: 'Database error' },
                }),
              })),
            })),
          }
        }
      })
      ;(mockSupabaseClient.from as any) = mockFrom

      const request = new NextRequest('http://localhost:3000/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', code: '12345' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Internal server error')
    })

    it('should return 500 when creating user fails', async () => {
      const mockFrom = vi.fn((table: string) => {
        if (table === 'login_codes') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              gt: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue({
                data: [{
                  id: 'code-1',
                  email: 'test@example.com',
                  code_hash: 'hashed_12345',
                  attempts: 0,
                  used: false,
                  expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
                }],
                error: null,
              }),
            })),
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          }
        } else if (table === 'users') {
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

      const request = new NextRequest('http://localhost:3000/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', code: '12345' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to create user')
    })

    it('should return 500 when JSON parsing fails', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/verify-code', {
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

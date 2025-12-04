/**
 * Unit tests for auth utilities (src/lib/auth.ts)
 * Tests session management, authentication, and authorization
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { IronSession } from 'iron-session'
import type { SessionData } from '@/types'

// Mock iron-session
const mockSession: Partial<IronSession<SessionData>> = {
  user: undefined,
  save: vi.fn(),
  destroy: vi.fn(),
}

vi.mock('iron-session', () => ({
  getIronSession: vi.fn(() => Promise.resolve(mockSession)),
}))

// Mock next/headers
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => Promise.resolve(new Map())),
}))

// Import after mocks are set up
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import {
  getSession,
  createSession,
  destroySession,
  getCurrentUser,
  requireAuth,
  requireRole,
  isTeacherEmail,
  AuthenticationError,
  AuthorizationError,
} from '@/lib/auth'

describe('auth utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset session user to undefined before each test
    mockSession.user = undefined
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // getSession()
  // ==========================================================================

  describe('getSession', () => {
    it('should return a session object', async () => {
      const session = await getSession()
      expect(session).toBeDefined()
      expect(getIronSession).toHaveBeenCalled()
    })

    it('should call cookies() to get cookie store', async () => {
      await getSession()
      expect(cookies).toHaveBeenCalled()
    })

    it('should pass correct session options to getIronSession', async () => {
      await getSession()
      expect(getIronSession).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          cookieName: 'pika_session',
          cookieOptions: expect.objectContaining({
            httpOnly: true,
            sameSite: 'lax',
          }),
        })
      )
    })
  })

  // ==========================================================================
  // createSession()
  // ==========================================================================

  describe('createSession', () => {
    it('should create session with correct user data', async () => {
      await createSession('user-1', 'test@student.com', 'student')

      expect(mockSession.user).toEqual({
        id: 'user-1',
        email: 'test@student.com',
        role: 'student',
      })
      expect(mockSession.save).toHaveBeenCalled()
    })

    it('should create session for teacher role', async () => {
      await createSession('teacher-1', 'teacher@gapps.yrdsb.ca', 'teacher')

      expect(mockSession.user).toEqual({
        id: 'teacher-1',
        email: 'teacher@gapps.yrdsb.ca',
        role: 'teacher',
      })
      expect(mockSession.save).toHaveBeenCalled()
    })

    it('should save the session after setting user', async () => {
      await createSession('user-1', 'test@student.com', 'student')
      expect(mockSession.save).toHaveBeenCalledTimes(1)
    })

    it('should overwrite existing session data', async () => {
      // Set initial user
      mockSession.user = {
        id: 'old-user',
        email: 'old@example.com',
        role: 'student',
      }

      await createSession('new-user', 'new@example.com', 'teacher')

      expect(mockSession.user).toEqual({
        id: 'new-user',
        email: 'new@example.com',
        role: 'teacher',
      })
    })
  })

  // ==========================================================================
  // destroySession()
  // ==========================================================================

  describe('destroySession', () => {
    it('should call destroy on session', async () => {
      await destroySession()
      expect(mockSession.destroy).toHaveBeenCalled()
    })

    it('should destroy session even if user is not set', async () => {
      mockSession.user = undefined
      await destroySession()
      expect(mockSession.destroy).toHaveBeenCalled()
    })

    it('should destroy session with existing user', async () => {
      mockSession.user = {
        id: 'user-1',
        email: 'test@student.com',
        role: 'student',
      }
      await destroySession()
      expect(mockSession.destroy).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // getCurrentUser()
  // ==========================================================================

  describe('getCurrentUser', () => {
    it('should return user when session has user', async () => {
      mockSession.user = {
        id: 'user-1',
        email: 'test@student.com',
        role: 'student',
      }

      const user = await getCurrentUser()
      expect(user).toEqual({
        id: 'user-1',
        email: 'test@student.com',
        role: 'student',
      })
    })

    it('should return null when session has no user', async () => {
      mockSession.user = undefined

      const user = await getCurrentUser()
      expect(user).toBeNull()
    })

    it('should return null when session user is explicitly null', async () => {
      mockSession.user = null as any

      const user = await getCurrentUser()
      expect(user).toBeNull()
    })

    it('should return correct user data for teacher', async () => {
      mockSession.user = {
        id: 'teacher-1',
        email: 'teacher@gapps.yrdsb.ca',
        role: 'teacher',
      }

      const user = await getCurrentUser()
      expect(user).toEqual({
        id: 'teacher-1',
        email: 'teacher@gapps.yrdsb.ca',
        role: 'teacher',
      })
    })
  })

  // ==========================================================================
  // requireAuth()
  // ==========================================================================

  describe('requireAuth', () => {
    it('should return user when authenticated', async () => {
      mockSession.user = {
        id: 'user-1',
        email: 'test@student.com',
        role: 'student',
      }

      const user = await requireAuth()
      expect(user).toEqual({
        id: 'user-1',
        email: 'test@student.com',
        role: 'student',
      })
    })

    it('should throw "Unauthorized" when not authenticated', async () => {
      mockSession.user = undefined

      await expect(requireAuth()).rejects.toThrow(AuthenticationError)
      await expect(requireAuth()).rejects.toThrow('Not authenticated')
    })

    it('should throw when session user is null', async () => {
      mockSession.user = null as any

      await expect(requireAuth()).rejects.toThrow(AuthenticationError)
      await expect(requireAuth()).rejects.toThrow('Not authenticated')
    })

    it('should return correct user object structure', async () => {
      mockSession.user = {
        id: 'teacher-1',
        email: 'teacher@gapps.yrdsb.ca',
        role: 'teacher',
      }

      const user = await requireAuth()
      expect(user).toHaveProperty('id')
      expect(user).toHaveProperty('email')
      expect(user).toHaveProperty('role')
    })

    it('should preserve all session user fields', async () => {
      mockSession.user = {
        id: 'user-1',
        email: 'test@student.com',
        role: 'student',
      }

      const user = await requireAuth()
      expect(user.id).toBe('user-1')
      expect(user.email).toBe('test@student.com')
      expect(user.role).toBe('student')
    })
  })

  // ==========================================================================
  // requireRole()
  // ==========================================================================

  describe('requireRole', () => {
    it('should return user when role matches (student)', async () => {
      mockSession.user = {
        id: 'user-1',
        email: 'test@student.com',
        role: 'student',
      }

      const user = await requireRole('student')
      expect(user).toEqual({
        id: 'user-1',
        email: 'test@student.com',
        role: 'student',
      })
    })

    it('should return user when role matches (teacher)', async () => {
      mockSession.user = {
        id: 'teacher-1',
        email: 'teacher@gapps.yrdsb.ca',
        role: 'teacher',
      }

      const user = await requireRole('teacher')
      expect(user).toEqual({
        id: 'teacher-1',
        email: 'teacher@gapps.yrdsb.ca',
        role: 'teacher',
      })
    })

    it('should throw "Forbidden" when role does not match', async () => {
      mockSession.user = {
        id: 'user-1',
        email: 'test@student.com',
        role: 'student',
      }

      await expect(requireRole('teacher')).rejects.toThrow(AuthorizationError)
      await expect(requireRole('teacher')).rejects.toThrow('Forbidden')
    })

    it('should throw "Unauthorized" when not authenticated', async () => {
      mockSession.user = undefined

      await expect(requireRole('student')).rejects.toThrow(AuthenticationError)
      await expect(requireRole('student')).rejects.toThrow('Not authenticated')
    })

    it('should include permission context in forbidden error message', async () => {
      mockSession.user = {
        id: 'user-1',
        email: 'test@student.com',
        role: 'student',
      }

      await expect(requireRole('teacher')).rejects.toThrow(AuthorizationError)
      await expect(requireRole('teacher')).rejects.toThrow(/teacher role required/)
    })

    it('should throw when student tries to access teacher route', async () => {
      mockSession.user = {
        id: 'student-1',
        email: 'student@example.com',
        role: 'student',
      }

      await expect(requireRole('teacher')).rejects.toThrow()
    })

    it('should throw when teacher tries to access student route', async () => {
      mockSession.user = {
        id: 'teacher-1',
        email: 'teacher@gapps.yrdsb.ca',
        role: 'teacher',
      }

      await expect(requireRole('student')).rejects.toThrow()
    })
  })

  // ==========================================================================
  // isTeacherEmail()
  // ==========================================================================

  describe('isTeacherEmail', () => {
    // Save original env
    const originalEnv = process.env.DEV_TEACHER_EMAILS

    afterEach(() => {
      // Restore original env
      process.env.DEV_TEACHER_EMAILS = originalEnv
    })

    it('should return true for @gapps.yrdsb.ca domain', () => {
      expect(isTeacherEmail('teacher@gapps.yrdsb.ca')).toBe(true)
    })

    it('should return true for @yrdsb.ca domain', () => {
      expect(isTeacherEmail('teacher@yrdsb.ca')).toBe(true)
    })

    it('should return true for emails in DEV_TEACHER_EMAILS', () => {
      process.env.DEV_TEACHER_EMAILS = 'dev@example.com,test@teacher.com'
      expect(isTeacherEmail('dev@example.com')).toBe(true)
      expect(isTeacherEmail('test@teacher.com')).toBe(true)
    })

    it('should return false for student domain emails', () => {
      expect(isTeacherEmail('student@example.com')).toBe(false)
    })

    it('should return false for unknown domains', () => {
      expect(isTeacherEmail('user@gmail.com')).toBe(false)
      expect(isTeacherEmail('admin@school.org')).toBe(false)
    })

    it('should be case sensitive for teacher domains', () => {
      // Email domains are case insensitive, but the function doesn't normalize
      // This tests the actual implementation behavior
      expect(isTeacherEmail('teacher@GAPPS.YRDSB.CA')).toBe(false)
    })

    it('should handle whitespace in DEV_TEACHER_EMAILS', () => {
      process.env.DEV_TEACHER_EMAILS = '  dev@example.com  , test@teacher.com  '
      expect(isTeacherEmail('dev@example.com')).toBe(true)
      expect(isTeacherEmail('test@teacher.com')).toBe(true)
    })

    it('should handle empty DEV_TEACHER_EMAILS env var', () => {
      process.env.DEV_TEACHER_EMAILS = ''
      expect(isTeacherEmail('dev@example.com')).toBe(false)
    })

    it('should handle undefined DEV_TEACHER_EMAILS env var', () => {
      delete process.env.DEV_TEACHER_EMAILS
      expect(isTeacherEmail('dev@example.com')).toBe(false)
    })

    it('should not match partial domain matches', () => {
      expect(isTeacherEmail('teacher@fakegapps.yrdsb.ca.evil.com')).toBe(false)
    })

    it('should match emails ending exactly with teacher domains', () => {
      expect(isTeacherEmail('any.teacher@gapps.yrdsb.ca')).toBe(true)
      expect(isTeacherEmail('teacher.name@yrdsb.ca')).toBe(true)
    })
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  clearExpiredLockout,
  getLockoutMinutesLeft,
  incrementLoginAttempts,
  loginAttempts,
} from '@/lib/login-lockout'

// Mock Supabase so DB calls don't fail in unit tests
vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => {
    throw new Error('DB not available in unit test')
  }),
}))

describe('login-lockout', () => {
  beforeEach(() => {
    // Clear the in-memory store before each test
    loginAttempts.clear()
    vi.clearAllTimers()
  })

  describe('clearExpiredLockout', () => {
    it('should do nothing if no attempts exist for email', async () => {
      await clearExpiredLockout('test@example.com')
      expect(loginAttempts.has('test@example.com')).toBe(false)
    })

    it('should do nothing if lockout has not expired', async () => {
      const futureTime = Date.now() + 10 * 60 * 1000 // 10 minutes from now
      loginAttempts.set('test@example.com', { count: 5, lockedUntil: futureTime })

      await clearExpiredLockout('test@example.com')

      expect(loginAttempts.has('test@example.com')).toBe(true)
    })

    it('should clear attempts if lockout has expired', async () => {
      const pastTime = Date.now() - 1000 // 1 second ago
      loginAttempts.set('test@example.com', { count: 5, lockedUntil: pastTime })

      await clearExpiredLockout('test@example.com')

      expect(loginAttempts.has('test@example.com')).toBe(false)
    })

    it('should clear attempts if lockout time equals current time', async () => {
      const now = Date.now()
      loginAttempts.set('test@example.com', { count: 5, lockedUntil: now })

      await clearExpiredLockout('test@example.com')

      expect(loginAttempts.has('test@example.com')).toBe(false)
    })
  })

  describe('getLockoutMinutesLeft', () => {
    it('should return null if no attempts exist', async () => {
      expect(await getLockoutMinutesLeft('test@example.com')).toBeNull()
    })

    it('should return null if lockout has expired', async () => {
      const pastTime = Date.now() - 1000
      loginAttempts.set('test@example.com', { count: 5, lockedUntil: pastTime })

      expect(await getLockoutMinutesLeft('test@example.com')).toBeNull()
    })

    it('should return minutes left if lockout is active', async () => {
      const futureTime = Date.now() + 10 * 60 * 1000 // 10 minutes from now
      loginAttempts.set('test@example.com', { count: 5, lockedUntil: futureTime })

      const minutesLeft = await getLockoutMinutesLeft('test@example.com')
      expect(minutesLeft).toBe(10)
    })

    it('should return null if no lockedUntil time is set', async () => {
      loginAttempts.set('test@example.com', { count: 3, lockedUntil: null })

      expect(await getLockoutMinutesLeft('test@example.com')).toBeNull()
    })
  })

  describe('incrementLoginAttempts', () => {
    it('should initialize count to 1 for new email', async () => {
      await incrementLoginAttempts('test@example.com')

      const attempts = loginAttempts.get('test@example.com')
      expect(attempts?.count).toBe(1)
      expect(attempts?.lockedUntil).toBeNull()
    })

    it('should increment existing attempt count', async () => {
      loginAttempts.set('test@example.com', { count: 2, lockedUntil: null })

      await incrementLoginAttempts('test@example.com')

      const attempts = loginAttempts.get('test@example.com')
      expect(attempts?.count).toBe(3)
    })

    it('should set lockout when reaching max attempts', async () => {
      loginAttempts.set('test@example.com', { count: 4, lockedUntil: null })

      const beforeLockout = Date.now()
      await incrementLoginAttempts('test@example.com')
      const afterLockout = Date.now()

      const attempts = loginAttempts.get('test@example.com')
      expect(attempts?.count).toBe(5)
      expect(attempts?.lockedUntil).toBeGreaterThanOrEqual(beforeLockout + 15 * 60 * 1000)
      expect(attempts?.lockedUntil).toBeLessThanOrEqual(afterLockout + 15 * 60 * 1000)
    })
  })
})

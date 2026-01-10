import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  clearExpiredLockout,
  getLockoutMinutesLeft,
  incrementLoginAttempts,
  loginAttempts,
} from '@/lib/login-lockout'

describe('login-lockout', () => {
  beforeEach(() => {
    // Clear the in-memory store before each test
    loginAttempts.clear()
    vi.clearAllTimers()
  })

  describe('clearExpiredLockout', () => {
    it('should do nothing if no attempts exist for email', () => {
      clearExpiredLockout('test@example.com')
      expect(loginAttempts.has('test@example.com')).toBe(false)
    })

    it('should do nothing if lockout has not expired', () => {
      const futureTime = Date.now() + 10 * 60 * 1000 // 10 minutes from now
      loginAttempts.set('test@example.com', { count: 5, lockedUntil: futureTime })

      clearExpiredLockout('test@example.com')

      expect(loginAttempts.has('test@example.com')).toBe(true)
    })

    it('should clear attempts if lockout has expired', () => {
      const pastTime = Date.now() - 1000 // 1 second ago
      loginAttempts.set('test@example.com', { count: 5, lockedUntil: pastTime })

      clearExpiredLockout('test@example.com')

      expect(loginAttempts.has('test@example.com')).toBe(false)
    })

    it('should clear attempts if lockout time equals current time', () => {
      const now = Date.now()
      loginAttempts.set('test@example.com', { count: 5, lockedUntil: now })

      clearExpiredLockout('test@example.com')

      expect(loginAttempts.has('test@example.com')).toBe(false)
    })
  })

  describe('getLockoutMinutesLeft', () => {
    it('should return null if no attempts exist', () => {
      expect(getLockoutMinutesLeft('test@example.com')).toBeNull()
    })

    it('should return null if lockout has expired', () => {
      const pastTime = Date.now() - 1000
      loginAttempts.set('test@example.com', { count: 5, lockedUntil: pastTime })

      expect(getLockoutMinutesLeft('test@example.com')).toBeNull()
    })

    it('should return minutes left if lockout is active', () => {
      const futureTime = Date.now() + 10 * 60 * 1000 // 10 minutes from now
      loginAttempts.set('test@example.com', { count: 5, lockedUntil: futureTime })

      const minutesLeft = getLockoutMinutesLeft('test@example.com')
      expect(minutesLeft).toBe(10)
    })

    it('should return null if no lockedUntil time is set', () => {
      loginAttempts.set('test@example.com', { count: 3, lockedUntil: null })

      expect(getLockoutMinutesLeft('test@example.com')).toBeNull()
    })
  })

  describe('incrementLoginAttempts', () => {
    it('should initialize count to 1 for new email', () => {
      incrementLoginAttempts('test@example.com')

      const attempts = loginAttempts.get('test@example.com')
      expect(attempts?.count).toBe(1)
      expect(attempts?.lockedUntil).toBeNull()
    })

    it('should increment existing attempt count', () => {
      loginAttempts.set('test@example.com', { count: 2, lockedUntil: null })

      incrementLoginAttempts('test@example.com')

      const attempts = loginAttempts.get('test@example.com')
      expect(attempts?.count).toBe(3)
    })

    it('should set lockout when reaching max attempts', () => {
      loginAttempts.set('test@example.com', { count: 4, lockedUntil: null })

      const beforeLockout = Date.now()
      incrementLoginAttempts('test@example.com')
      const afterLockout = Date.now()

      const attempts = loginAttempts.get('test@example.com')
      expect(attempts?.count).toBe(5)
      expect(attempts?.lockedUntil).toBeGreaterThanOrEqual(beforeLockout + 15 * 60 * 1000)
      expect(attempts?.lockedUntil).toBeLessThanOrEqual(afterLockout + 15 * 60 * 1000)
    })

    it('should schedule cleanup after lockout expires (using fake timers)', () => {
      vi.useFakeTimers()
      loginAttempts.set('test@example.com', { count: 4, lockedUntil: null })

      incrementLoginAttempts('test@example.com')

      // Verify lockout is set
      expect(loginAttempts.has('test@example.com')).toBe(true)

      // Fast-forward time past lockout expiry (15 min + 10ms)
      vi.advanceTimersByTime(15 * 60 * 1000 + 10)

      // Cleanup should have removed the entry
      expect(loginAttempts.has('test@example.com')).toBe(false)

      vi.useRealTimers()
    })

    it('should schedule cleanup after 1 hour for non-lockout attempts (using fake timers)', () => {
      vi.useFakeTimers()

      incrementLoginAttempts('test@example.com') // First attempt

      // Verify attempt exists
      expect(loginAttempts.has('test@example.com')).toBe(true)

      // Fast-forward time past 1 hour but set lockout to expired first
      const attempts = loginAttempts.get('test@example.com')!
      attempts.lockedUntil = Date.now() - 1000 // Set to expired

      vi.advanceTimersByTime(60 * 60 * 1000) // 1 hour

      // Cleanup should have removed the entry
      expect(loginAttempts.has('test@example.com')).toBe(false)

      vi.useRealTimers()
    })

    it('should not cleanup if lockout time is still in the future after 1 hour cleanup timer', () => {
      vi.useFakeTimers()
      const startTime = Date.now()

      incrementLoginAttempts('test@example.com')

      // Set a far future lockout time (after the 1-hour cleanup would run)
      const attempts = loginAttempts.get('test@example.com')!
      attempts.lockedUntil = startTime + 2 * 60 * 60 * 1000 // 2 hours from start

      // Advance exactly 1 hour (when the 1-hour cleanup timer fires)
      vi.advanceTimersByTime(60 * 60 * 1000)

      // Should not be cleaned up because lockedUntil (2 hours) > current time (1 hour)
      expect(loginAttempts.has('test@example.com')).toBe(true)

      vi.useRealTimers()
    })
  })
})

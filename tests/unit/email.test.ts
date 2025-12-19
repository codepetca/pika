/**
 * Unit tests for email utilities (src/lib/email.ts)
 * Tests email sending in mock and production modes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendSignupCode, sendPasswordResetCode } from '@/lib/email'

describe('email utilities', () => {
  // Save original env
  const originalEnv = process.env.ENABLE_MOCK_EMAIL

  // Spy on console.log
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    process.env.ENABLE_MOCK_EMAIL = originalEnv
  })

  // ==========================================================================
  // sendSignupCode()
  // ==========================================================================

  describe('sendSignupCode', () => {
    it('should log to console when ENABLE_MOCK_EMAIL=true', async () => {
      process.env.ENABLE_MOCK_EMAIL = 'true'

      await sendSignupCode('test@example.com', 'ABC12')

      expect(consoleLogSpy).toHaveBeenCalled()
      const allLogs = consoleLogSpy.mock.calls.flat().join(' ')
      expect(allLogs).toContain('test@example.com')
      expect(allLogs).toContain('ABC12')
    })

    it('should include proper subject line in console output', async () => {
      process.env.ENABLE_MOCK_EMAIL = 'true'

      await sendSignupCode('test@example.com', 'ABC12')

      const allLogs = consoleLogSpy.mock.calls.flat().join(' ')
      expect(allLogs).toContain('Verify your email')
    })

    it('should include expiry message (10 minutes)', async () => {
      process.env.ENABLE_MOCK_EMAIL = 'true'

      await sendSignupCode('test@example.com', 'ABC12')

      const allLogs = consoleLogSpy.mock.calls.flat().join(' ')
      expect(allLogs).toContain('10 minutes')
    })

    it('should return void', async () => {
      process.env.ENABLE_MOCK_EMAIL = 'true'

      const result = await sendSignupCode('test@example.com', 'ABC12')

      expect(result).toBeUndefined()
    })

    it('should throw error in production mode', async () => {
      process.env.ENABLE_MOCK_EMAIL = 'false'

      await expect(sendSignupCode('test@example.com', 'ABC12')).rejects.toThrow(
        'Production email sending not implemented'
      )
    })

    it('should have proper formatting with separators', async () => {
      process.env.ENABLE_MOCK_EMAIL = 'true'

      await sendSignupCode('test@example.com', 'ABC12')

      const allLogs = consoleLogSpy.mock.calls.flat().join(' ')
      // Check for separator lines (=====)
      expect(allLogs).toMatch(/=+/)
    })
  })

  // ==========================================================================
  // sendPasswordResetCode()
  // ==========================================================================

  describe('sendPasswordResetCode', () => {
    it('should log to console when ENABLE_MOCK_EMAIL=true', async () => {
      process.env.ENABLE_MOCK_EMAIL = 'true'

      await sendPasswordResetCode('test@example.com', 'XYZ99')

      expect(consoleLogSpy).toHaveBeenCalled()
      const allLogs = consoleLogSpy.mock.calls.flat().join(' ')
      expect(allLogs).toContain('test@example.com')
      expect(allLogs).toContain('XYZ99')
    })

    it('should include "did not request" warning in console output', async () => {
      process.env.ENABLE_MOCK_EMAIL = 'true'

      await sendPasswordResetCode('test@example.com', 'XYZ99')

      const allLogs = consoleLogSpy.mock.calls.flat().join(' ')
      expect(allLogs).toContain('did not request')
    })

    it('should include expiry message', async () => {
      process.env.ENABLE_MOCK_EMAIL = 'true'

      await sendPasswordResetCode('test@example.com', 'XYZ99')

      const allLogs = consoleLogSpy.mock.calls.flat().join(' ')
      expect(allLogs).toContain('10 minutes')
    })

    it('should return void', async () => {
      process.env.ENABLE_MOCK_EMAIL = 'true'

      const result = await sendPasswordResetCode('test@example.com', 'XYZ99')

      expect(result).toBeUndefined()
    })

    it('should throw error in production mode', async () => {
      process.env.ENABLE_MOCK_EMAIL = 'false'

      await expect(sendPasswordResetCode('test@example.com', 'XYZ99')).rejects.toThrow(
        'Production email sending not implemented'
      )
    })

    it('should include password reset subject', async () => {
      process.env.ENABLE_MOCK_EMAIL = 'true'

      await sendPasswordResetCode('test@example.com', 'XYZ99')

      const allLogs = consoleLogSpy.mock.calls.flat().join(' ')
      expect(allLogs).toContain('Reset your')
      expect(allLogs).toContain('password')
    })

    it('should have all expected sections in output', async () => {
      process.env.ENABLE_MOCK_EMAIL = 'true'

      await sendPasswordResetCode('test@example.com', 'XYZ99')

      const allLogs = consoleLogSpy.mock.calls.flat().join(' ')
      expect(allLogs).toContain('To:')
      expect(allLogs).toContain('Subject:')
      expect(allLogs).toContain('code')
      expect(allLogs).toContain('expire')
    })
  })

  // ==========================================================================
  // General behavior
  // ==========================================================================

  describe('general behavior', () => {
    it('should default to production mode when ENABLE_MOCK_EMAIL is undefined', async () => {
      delete process.env.ENABLE_MOCK_EMAIL

      await expect(sendSignupCode('test@example.com', 'ABC12')).rejects.toThrow()
      await expect(sendPasswordResetCode('test@example.com', 'XYZ99')).rejects.toThrow()
    })

    it('should treat ENABLE_MOCK_EMAIL=false as production mode', async () => {
      process.env.ENABLE_MOCK_EMAIL = 'false'

      await expect(sendSignupCode('test@example.com', 'ABC12')).rejects.toThrow()
      await expect(sendPasswordResetCode('test@example.com', 'XYZ99')).rejects.toThrow()
    })

    it('should only be in mock mode when explicitly set to "true"', async () => {
      process.env.ENABLE_MOCK_EMAIL = 'yes' // Not "true"

      await expect(sendSignupCode('test@example.com', 'ABC12')).rejects.toThrow()
    })
  })
})

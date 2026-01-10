import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  generateVerificationCode,
  hashCode,
  verifyCode,
  hashPassword,
  verifyPassword,
  validatePassword,
} from '@/lib/crypto'

describe('crypto utilities', () => {
  describe('hashCode and verifyCode', () => {
    it('should hash and verify a code correctly', async () => {
      const plainCode = 'ABC12345'
      const hashedCode = await hashCode(plainCode)

      expect(hashedCode).not.toBe(plainCode)
      expect(hashedCode.length).toBeGreaterThan(0)

      const isValid = await verifyCode(plainCode, hashedCode)
      expect(isValid).toBe(true)
    })

    it('should reject incorrect codes', async () => {
      const plainCode = 'ABC12345'
      const wrongCode = 'XYZ99999'
      const hashedCode = await hashCode(plainCode)

      const isValid = await verifyCode(wrongCode, hashedCode)
      expect(isValid).toBe(false)
    })

    it('should be case-sensitive', async () => {
      const plainCode = 'ABC12345'
      const hashedCode = await hashCode(plainCode)

      const isValid = await verifyCode('abc12345', hashedCode)
      expect(isValid).toBe(false)
    })
  })

  describe('generateVerificationCode', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should generate a 5 character uppercase alphanumeric code', () => {
      const code = generateVerificationCode()
      expect(code).toHaveLength(5)
      expect(code).toMatch(/^[A-Z0-9]{5}$/)
    })

    it('should use Math.random to choose characters', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0)
      expect(generateVerificationCode()).toBe('AAAAA')
    })
  })

  describe('hashPassword and verifyPassword', () => {
    it('should hash and verify a password correctly', async () => {
      const plainPassword = 'correct horse battery staple'
      const hashedPassword = await hashPassword(plainPassword)

      expect(hashedPassword).not.toBe(plainPassword)
      expect(hashedPassword.length).toBeGreaterThan(0)

      await expect(verifyPassword(plainPassword, hashedPassword)).resolves.toBe(true)
      await expect(verifyPassword('wrong password', hashedPassword)).resolves.toBe(false)
    })
  })

  describe('validatePassword', () => {
    it('should reject empty/short passwords', () => {
      expect(validatePassword('')).toBe('Password must be at least 8 characters long')
      expect(validatePassword('short')).toBe('Password must be at least 8 characters long')
    })

    it('should accept passwords with length >= 8', () => {
      expect(validatePassword('12345678')).toBeNull()
    })
  })
})

import { describe, it, expect } from 'vitest'
import { generateCode, hashCode, verifyCode } from '@/lib/crypto'

describe('crypto utilities', () => {
  describe('generateCode', () => {
    it('should generate a code of the default length (8)', () => {
      const code = generateCode()
      expect(code).toHaveLength(8)
    })

    it('should generate a code of custom length', () => {
      const code = generateCode(6)
      expect(code).toHaveLength(6)
    })

    it('should only contain alphanumeric characters', () => {
      const code = generateCode()
      expect(code).toMatch(/^[A-Z2-9]+$/)
    })

    it('should generate unique codes', () => {
      const code1 = generateCode()
      const code2 = generateCode()
      expect(code1).not.toBe(code2)
    })
  })

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
})

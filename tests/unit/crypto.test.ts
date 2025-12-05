import { describe, it, expect } from 'vitest'
import { hashCode, verifyCode } from '@/lib/crypto'

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
})

import { expect, it } from 'vitest'
import bcrypt from 'bcryptjs'
import { createPasswordSchema, resetPasswordConfirmSchema, loginSchema } from '@/lib/validations/auth'
import { hashPassword, verifyPassword, validatePassword } from '@/lib/crypto'

for (const [name, schema] of [['signup', createPasswordSchema], ['reset', resetPasswordConfirmSchema]] as const) {
  for (const password of ['a'.repeat(73), 'é'.repeat(37), '🙂'.repeat(19)]) {
    it(name + ': rejects new credentials beyond 72 UTF-8 bytes (' + password.length + ' code units)', () => {
      expect(schema.safeParse({ email: 'test@example.com', password, passwordConfirmation: password,
        handoffToken: 'h'.repeat(36) }).success).toBe(false)
    })
  }
  for (const password of ['a'.repeat(72), 'é'.repeat(36), '🙂'.repeat(18)]) {
    it(name + ': accepts the exact 72-byte boundary', () => {
      expect(schema.safeParse({ email: 'test@example.com', password, passwordConfirmation: password,
        handoffToken: 'h'.repeat(36) }).success).toBe(true)
    })
  }
}
it('hash creation rejects oversized bytes even without an HTTP boundary', async () => {
  await expect(hashPassword('a'.repeat(73))).rejects.toThrow('72')
  await expect(hashPassword('é'.repeat(37))).rejects.toThrow('72')
  expect(validatePassword('🙂'.repeat(19))).toContain('72')
})
it('legacy long-password login retains the existing bcrypt verification semantics', async () => {
  const password = 'a'.repeat(72) + 'legacy suffix'
  const legacyHash = await bcrypt.hash(password, 4)
  expect(loginSchema.safeParse({ email: 'test@example.com', password }).success).toBe(true)
  await expect(verifyPassword(password, legacyHash)).resolves.toBe(true)
})
it('supported passwords differing within the byte boundary remain distinct', async () => {
  const password = 'é'.repeat(35) + 'aa'
  const hash = await hashPassword(password)
  await expect(verifyPassword('é'.repeat(35) + 'ab', hash)).resolves.toBe(false)
})

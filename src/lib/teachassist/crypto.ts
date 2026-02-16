import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

/**
 * AES-256-GCM encryption for TeachAssist credentials.
 *
 * Requires TEACHASSIST_ENCRYPTION_KEY env var — a 64-character hex string
 * (32 bytes). Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Stored format: <iv_hex>:<authTag_hex>:<ciphertext_hex>
 */

function getKey(): Buffer {
  const key = process.env.TEACHASSIST_ENCRYPTION_KEY
  if (!key) throw new Error('TEACHASSIST_ENCRYPTION_KEY is not set')
  if (key.length !== 64) {
    throw new Error('TEACHASSIST_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)')
  }
  return Buffer.from(key, 'hex')
}

export function encryptPassword(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(12) // 96-bit IV — recommended for AES-GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`
}

export function decryptPassword(stored: string): string {
  const key = getKey()
  const parts = stored.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted password format')
  }
  const [ivHex, authTagHex, ciphertextHex] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const ciphertext = Buffer.from(ciphertextHex, 'hex')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8')
}

import bcrypt from 'bcryptjs'

const CODE_LENGTH = 8
const SALT_ROUNDS = 10

/**
 * Generates a random alphanumeric code
 */
export function generateCode(length: number = CODE_LENGTH): string {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // Removed ambiguous characters
  let code = ''

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length)
    code += characters[randomIndex]
  }

  return code
}

/**
 * Hashes a code using bcrypt
 */
export async function hashCode(code: string): Promise<string> {
  return bcrypt.hash(code, SALT_ROUNDS)
}

/**
 * Compares a plain code with a hashed code
 */
export async function verifyCode(plainCode: string, hashedCode: string): Promise<boolean> {
  return bcrypt.compare(plainCode, hashedCode)
}

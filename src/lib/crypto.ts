import bcrypt from 'bcryptjs'

const VERIFICATION_CODE_LENGTH = 5 // For email verification (signup/reset)
const SALT_ROUNDS = 10

/**
 * Generates a random alphanumeric verification code (5 characters)
 * Used for email verification during signup and password reset
 *
 * Excludes confusing characters: O, 0, I, L (same as classroom codes)
 */
export function generateVerificationCode(): string {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''

  for (let i = 0; i < VERIFICATION_CODE_LENGTH; i++) {
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

/**
 * Hashes a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

/**
 * Compares a plain password with a hashed password
 */
export async function verifyPassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, hashedPassword)
}

/**
 * Validates password meets minimum requirements
 * - At least 8 characters
 * - Returns error message if invalid, null if valid
 */
export function validatePassword(password: string): string | null {
  if (!password || password.length < 8) {
    return 'Password must be at least 8 characters long'
  }

  return null
}

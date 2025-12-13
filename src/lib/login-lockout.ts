export type LoginAttemptState = {
  count: number
  lockedUntil: number | null
}

const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 15 * 60 * 1000 // 15 minutes

// In-memory store for login attempts (in production, use Redis or DB)
export const loginAttempts = new Map<string, LoginAttemptState>()

export function clearExpiredLockout(email: string) {
  const existingAttempts = loginAttempts.get(email)
  if (existingAttempts?.lockedUntil && Date.now() >= existingAttempts.lockedUntil) {
    loginAttempts.delete(email)
  }
}

export function getLockoutMinutesLeft(email: string): number | null {
  const attempts = loginAttempts.get(email)
  if (attempts?.lockedUntil && Date.now() < attempts.lockedUntil) {
    return Math.ceil((attempts.lockedUntil - Date.now()) / 60000)
  }
  return null
}

export function incrementLoginAttempts(email: string) {
  const attempts = loginAttempts.get(email) || { count: 0, lockedUntil: null }
  attempts.count++

  if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
    attempts.lockedUntil = Date.now() + LOCKOUT_DURATION_MS
    setTimeout(() => {
      const current = loginAttempts.get(email)
      if (current && current.lockedUntil && Date.now() >= current.lockedUntil) {
        loginAttempts.delete(email)
      }
    }, LOCKOUT_DURATION_MS + 10)
  }

  loginAttempts.set(email, attempts)

  // Clean up old entries after 1 hour
  setTimeout(() => {
    const current = loginAttempts.get(email)
    if (current && current.lockedUntil && Date.now() > current.lockedUntil) {
      loginAttempts.delete(email)
    }
  }, 60 * 60 * 1000)
}


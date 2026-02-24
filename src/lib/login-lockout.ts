import { getServiceRoleClient } from '@/lib/supabase'

export type LoginAttemptState = {
  count: number
  lockedUntil: number | null
}

const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 15 * 60 * 1000 // 15 minutes

// In-memory fallback (used if DB is unavailable)
export const loginAttempts = new Map<string, LoginAttemptState>()

// ---------------------------------------------------------------------------
// Database-backed login lockout (preferred in production)
// Falls back to in-memory when Supabase is unavailable.
// ---------------------------------------------------------------------------

/**
 * Clears expired lockout for an email (DB + in-memory).
 */
export async function clearExpiredLockout(email: string): Promise<void> {
  // Always clear in-memory
  const existing = loginAttempts.get(email)
  if (existing?.lockedUntil && Date.now() >= existing.lockedUntil) {
    loginAttempts.delete(email)
  }

  try {
    const supabase = getServiceRoleClient()
    const now = new Date().toISOString()
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    // Delete rows that are either:
    //   (a) locked but the lockout has expired, or
    //   (b) not locked (NULL) but stale (updated_at > 1 hour ago)
    // This matches the cleanup_expired_login_attempts() SQL function in migration 039.
    await supabase
      .from('login_attempts')
      .delete()
      .eq('email', email)
      .or(`locked_until.lt.${now},and(locked_until.is.null,updated_at.lt.${oneHourAgo})`)
  } catch {
    // DB unavailable — in-memory was already cleared above
  }
}

/**
 * Returns the number of minutes left in the lockout, or null if not locked.
 */
export async function getLockoutMinutesLeft(email: string): Promise<number | null> {
  try {
    const supabase = getServiceRoleClient()
    const { data } = await supabase
      .from('login_attempts')
      .select('locked_until')
      .eq('email', email)
      .single()

    if (data?.locked_until) {
      const lockedUntil = new Date(data.locked_until).getTime()
      if (Date.now() < lockedUntil) {
        return Math.ceil((lockedUntil - Date.now()) / 60000)
      }
    }
  } catch {
    // DB unavailable — fall through to in-memory
  }

  // In-memory fallback
  const attempts = loginAttempts.get(email)
  if (attempts?.lockedUntil && Date.now() < attempts.lockedUntil) {
    return Math.ceil((attempts.lockedUntil - Date.now()) / 60000)
  }
  return null
}

/**
 * Increments the failed login attempt count. Locks out after MAX_LOGIN_ATTEMPTS.
 */
export async function incrementLoginAttempts(email: string): Promise<void> {
  // Always update in-memory (fallback)
  const memAttempts = loginAttempts.get(email) || { count: 0, lockedUntil: null }
  memAttempts.count++
  if (memAttempts.count >= MAX_LOGIN_ATTEMPTS) {
    memAttempts.lockedUntil = Date.now() + LOCKOUT_DURATION_MS
  }
  loginAttempts.set(email, memAttempts)

  try {
    const supabase = getServiceRoleClient()

    // Upsert: increment count, set lockout if threshold reached
    const { data: existing } = await supabase
      .from('login_attempts')
      .select('count')
      .eq('email', email)
      .single()

    const newCount = (existing?.count ?? 0) + 1
    const lockedUntil = newCount >= MAX_LOGIN_ATTEMPTS
      ? new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString()
      : null

    await supabase
      .from('login_attempts')
      .upsert({
        email,
        count: newCount,
        locked_until: lockedUntil,
        updated_at: new Date().toISOString(),
      })
  } catch {
    // DB unavailable — in-memory was already updated above
  }
}

/**
 * Resets login attempts for an email (called on successful login).
 */
export async function resetLoginAttempts(email: string): Promise<void> {
  loginAttempts.delete(email)

  try {
    const supabase = getServiceRoleClient()
    await supabase
      .from('login_attempts')
      .delete()
      .eq('email', email)
  } catch {
    // DB unavailable — in-memory was already cleared
  }
}

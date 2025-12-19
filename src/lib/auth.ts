import { getIronSession, IronSession } from 'iron-session'
import { cookies } from 'next/headers'
import type { SessionData, UserRole } from '@/types'

/**
 * Custom error class for authentication failures (401)
 */
export class AuthenticationError extends Error {
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'AuthenticationError'
  }
}

/**
 * Custom error class for authorization failures (403)
 */
export class AuthorizationError extends Error {
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'AuthorizationError'
  }
}

const sessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: 'pika_session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax' as const,
    maxAge: 14 * 24 * 60 * 60, // 14 days
  },
}

if (!sessionOptions.password || sessionOptions.password.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters')
}

/**
 * Gets the current session
 */
export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, sessionOptions)
}

/**
 * Creates a new session for a user
 */
export async function createSession(userId: string, email: string, role: UserRole) {
  const session = await getSession()
  session.user = {
    id: userId,
    email,
    role,
  }
  await session.save()
}

/**
 * Destroys the current session
 */
export async function destroySession() {
  const session = await getSession()
  session.destroy()
}

/**
 * Gets the current user from session (or null if not authenticated)
 */
export async function getCurrentUser(): Promise<SessionData['user'] | null> {
  const session = await getSession()
  return session.user || null
}

/**
 * Requires authentication - throws AuthenticationError if not authenticated
 */
export async function requireAuth(): Promise<SessionData['user']> {
  const user = await getCurrentUser()

  if (!user) {
    throw new AuthenticationError('Not authenticated')
  }

  return user
}

/**
 * Requires specific role - throws AuthenticationError if not authenticated, AuthorizationError if wrong role
 */
export async function requireRole(role: UserRole): Promise<SessionData['user']> {
  const user = await requireAuth()  // Throws AuthenticationError if not logged in

  if (user.role !== role) {
    throw new AuthorizationError(`Forbidden: ${role} role required`)
  }

  return user
}

/**
 * Determines if an email belongs to a teacher
 *
 * Teachers are identified by:
 * 1. @yrdsb.ca or @gapps.yrdsb.ca with alphabetic local part (e.g., john.smith@gapps.yrdsb.ca)
 *    - Students have numeric-only local parts (e.g., 123456789@gapps.yrdsb.ca or 123456789@yrdsb.ca)
 * 2. Email in DEV_TEACHER_EMAILS list (for testing with other domains)
 *
 * @example
 * isTeacherEmail('teacher@yrdsb.ca') // true
 * isTeacherEmail('123456789@yrdsb.ca') // false (student)
 * isTeacherEmail('john.smith@gapps.yrdsb.ca') // true
 * isTeacherEmail('john.h.smith@gapps.yrdsb.ca') // true
 * isTeacherEmail('123456789@gapps.yrdsb.ca') // false (student)
 * isTeacherEmail('student@student.yrdsb.ca') // false
 */
export function isTeacherEmail(email: string): boolean {
  const normalizedEmail = email.toLowerCase().trim()

  // Extract local part (before @) and domain (after @)
  const [localPart, domain] = normalizedEmail.split('@')

  if (!localPart || !domain) {
    return false
  }

  // Rule 1: @yrdsb.ca or @gapps.yrdsb.ca → check if numeric-only
  // Students have numeric-only local parts (e.g., 123456789)
  // Teachers have alphabetic local parts (e.g., john.smith)
  if (domain === 'yrdsb.ca' || domain === 'gapps.yrdsb.ca') {
    const isNumericOnly = /^\d+$/.test(localPart)
    if (isNumericOnly) {
      return false  // Student
    }
    // If not numeric-only, it's a teacher
    return true
  }

  // Rule 2: Check dev teacher list for other domains
  const devTeachers = process.env.DEV_TEACHER_EMAILS?.split(',').map(e => e.trim().toLowerCase()) || []
  if (devTeachers.includes(normalizedEmail)) {
    return true
  }

  // Default: student
  return false
}

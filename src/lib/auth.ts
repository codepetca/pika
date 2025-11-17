import { getIronSession, IronSession } from 'iron-session'
import { cookies } from 'next/headers'
import type { SessionData, UserRole } from '@/types'

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
 * Requires authentication - throws if not authenticated
 */
export async function requireAuth(): Promise<SessionData['user']> {
  const user = await getCurrentUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  return user
}

/**
 * Requires specific role - throws if not authenticated or wrong role
 */
export async function requireRole(role: UserRole): Promise<SessionData['user']> {
  const user = await requireAuth()

  if (user.role !== role) {
    throw new Error('Forbidden: insufficient permissions')
  }

  return user
}

/**
 * Determines if an email belongs to a teacher
 * Teachers are identified by:
 * 1. Email ending with @gapps.yrdsb.ca or @yrdsb.ca
 * 2. Email in DEV_TEACHER_EMAILS list
 */
export function isTeacherEmail(email: string): boolean {
  const teacherDomains = ['@gapps.yrdsb.ca', '@yrdsb.ca']

  // Check if email ends with teacher domain
  if (teacherDomains.some(domain => email.endsWith(domain))) {
    return true
  }

  // Check dev teacher list
  const devTeachers = process.env.DEV_TEACHER_EMAILS?.split(',').map(e => e.trim()) || []
  if (devTeachers.includes(email)) {
    return true
  }

  return false
}

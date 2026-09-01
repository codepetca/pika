import { getIronSession, IronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { AuthenticatedUser, SessionData, UserRole } from '@/types'
import {
  AUTH_SESSION_MAX_AGE_SECONDS,
  AUTH_SESSION_TTL_SECONDS,
  AUTH_SESSION_VERSION,
} from '@/lib/auth-session-policy'
import { recordPalAuthenticatedSession } from '@/lib/server/pal-signals'
import { isWorkOSMagicAuthPilotEnabled } from '@/lib/server/workos-pilot'
import { getServiceRoleClient } from '@/lib/supabase'

const AUTH_SESSION_TOKEN_BYTES = 32

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

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

function getSessionOptions() {
  const password = process.env.SESSION_SECRET

  if (!password || password.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters')
  }

  return {
    password,
    cookieName: 'pika_session',
    ttl: AUTH_SESSION_TTL_SECONDS,
    cookieOptions: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax' as const,
      maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
    },
  }
}

/**
 * Gets the current session
 */
export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, getSessionOptions())
}

/**
 * Creates a new session for a user
 */
export async function createSession(
  userId: string,
  email: string,
  role: UserRole,
  options: {
    workosUserId?: string
    recordAuthenticationEvent?: boolean
  } = {},
) {
  const session = await getSession()
  const supabase = getServiceRoleClient()
  const { error: cleanupError } = await supabase
    .from('auth_sessions')
    .delete()
    .lte('expires_at', new Date().toISOString())
  if (cleanupError) {
    // Cleanup is best-effort so a transient maintenance failure does not turn
    // into an authentication outage. The indexed sweep repeats at next login.
    console.error('Failed to remove expired authentication sessions:', cleanupError)
  }

  const previousToken = session.auth?.version === AUTH_SESSION_VERSION
    ? session.auth.token
    : null
  if (previousToken) {
    const { error: revokeError } = await supabase
      .from('auth_sessions')
      .delete()
      .eq('token_hash', hashSessionToken(previousToken))
    if (revokeError) {
      console.error('Failed to rotate existing authentication session:', revokeError)
      throw new Error('Failed to create authentication session')
    }
  }

  const token = randomBytes(AUTH_SESSION_TOKEN_BYTES).toString('base64url')
  const authSource = options.workosUserId ? 'workos' : 'password'
  const { error: insertError } = await supabase.from('auth_sessions').insert({
    user_id: userId,
    token_hash: hashSessionToken(token),
    auth_source: authSource,
    workos_user_id: options.workosUserId || null,
    expires_at: new Date(Date.now() + AUTH_SESSION_MAX_AGE_SECONDS * 1000).toISOString(),
  })
  if (insertError) {
    console.error('Failed to persist authentication session:', insertError)
    throw new Error('Failed to create authentication session')
  }

  session.auth = {
    token,
    version: AUTH_SESSION_VERSION,
  }
  await session.save()

  if (role === 'student' && options.recordAuthenticationEvent !== false) {
    await recordPalAuthenticatedSession({
      studentId: userId,
      sessionId: randomUUID(),
    })
  }
}

/**
 * Destroys the current session
 */
export async function destroySession() {
  const session = await getSession()
  let revokeError: unknown = null
  if (session.auth?.version === AUTH_SESSION_VERSION) {
    const supabase = getServiceRoleClient()
    const { error } = await supabase
      .from('auth_sessions')
      .delete()
      .eq('token_hash', hashSessionToken(session.auth.token))
    revokeError = error
  }
  session.destroy()
  if (revokeError) {
    console.error('Failed to revoke authentication session:', revokeError)
    throw new Error('Failed to revoke authentication session')
  }
}

/**
 * Gets the current user from session (or null if not authenticated)
 */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const session = await getSession()
  if (session.auth?.version !== AUTH_SESSION_VERSION || !session.auth.token) {
    return null
  }

  const supabase = getServiceRoleClient()
  const { data: resolvedSession, error } = await supabase
    .from('auth_sessions')
    .select(`
      user_id,
      auth_source,
      workos_user_id,
      expires_at,
      users!inner(id, email, role, workos_user_id)
    `)
    .eq('token_hash', hashSessionToken(session.auth.token))
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (error) {
    console.error('Failed to resolve authentication session:', error)
    return null
  }
  if (!resolvedSession) return null

  const currentUser = resolvedSession.users
  if (
    currentUser.id !== resolvedSession.user_id
    || (currentUser.role !== 'student' && currentUser.role !== 'teacher')
    || (resolvedSession.auth_source !== 'password' && resolvedSession.auth_source !== 'workos')
  ) {
    return null
  }

  const pikaUser: AuthenticatedUser = {
    id: currentUser.id,
    email: currentUser.email,
    role: currentUser.role,
    authSource: resolvedSession.auth_source,
    ...(resolvedSession.workos_user_id
      ? { workosUserId: resolvedSession.workos_user_id }
      : {}),
  }

  if (!isWorkOSMagicAuthPilotEnabled()) {
    // Only current sessions explicitly issued by the password flow remain
    // credentials during rollback. WorkOS mappings and ambiguous legacy seals
    // fail closed rather than being promoted into independent credentials.
    return (
      pikaUser.authSource === 'password'
      && !pikaUser.workosUserId
    ) ? pikaUser : null
  }

  // During the pilot, the Pika cookie is only an internal identity/role
  // mapping. WorkOS remains the credential and browser-session authority.
  // Requiring both prevents an older Pika-only cookie from authorizing native
  // attendance commands after its WorkOS credential is gone.
  const { withAuth } = await import('@workos-inc/authkit-nextjs')
  const { user: workOSUser } = await withAuth()
  if (!workOSUser || !workOSUser.emailVerified) {
    return null
  }

  if (
    pikaUser.authSource !== 'workos'
    || !pikaUser.workosUserId
    || pikaUser.workosUserId !== workOSUser.id
    || pikaUser.workosUserId !== currentUser.workos_user_id
  ) {
    return null
  }

  const pikaEmail = pikaUser.email.trim().toLowerCase()
  const workOSEmail = workOSUser.email.trim().toLowerCase()
  return pikaEmail === workOSEmail ? pikaUser : null
}

/**
 * Requires authentication - throws AuthenticationError if not authenticated
 */
export async function requireAuth(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser()

  if (!user) {
    throw new AuthenticationError('Not authenticated')
  }

  return user
}

/**
 * Requires specific role - throws AuthenticationError if not authenticated, AuthorizationError if wrong role
 */
export async function requireRole(role: UserRole): Promise<AuthenticatedUser> {
  const user = await requireAuth()  // Throws AuthenticationError if not logged in

  if (user.role !== role) {
    throw new AuthorizationError(`Forbidden: ${role} role required`)
  }

  return user
}

/**
 * Requires a user who can view the snapshot gallery:
 * - any authenticated teacher in non-production environments only
 */
export async function requireSnapshotGalleryAccess(): Promise<AuthenticatedUser> {
  const user = await requireRole('teacher')

  if (process.env.NODE_ENV === 'production') {
    throw new AuthorizationError('Forbidden: snapshot gallery is disabled in production')
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

import { getIronSession, type IronSession } from 'iron-session'
import { cookies } from 'next/headers'

const PENDING_COOKIE_MAX_AGE_SECONDS = 10 * 60

export type WorkOSMagicIntent = 'sign-in' | 'sign-up'

export interface PendingWorkOSMagicAuth {
  email: string
  expiresAt: string
  intent: WorkOSMagicIntent
  nextPath: string
  radarAuthAttemptId?: string
}

interface PendingWorkOSMagicSession {
  challenge?: PendingWorkOSMagicAuth
}

function pendingSessionOptions() {
  const password = process.env.SESSION_SECRET
  if (!password || password.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters')
  }

  return {
    password,
    cookieName: 'pika_workos_magic',
    cookieOptions: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax' as const,
      maxAge: PENDING_COOKIE_MAX_AGE_SECONDS,
    },
  }
}

async function getPendingSession(): Promise<IronSession<PendingWorkOSMagicSession>> {
  return getIronSession<PendingWorkOSMagicSession>(await cookies(), pendingSessionOptions())
}

export async function savePendingWorkOSMagicAuth(challenge: PendingWorkOSMagicAuth): Promise<void> {
  const session = await getPendingSession()
  session.challenge = challenge
  await session.save()
}

export async function readPendingWorkOSMagicAuth(): Promise<PendingWorkOSMagicAuth | null> {
  const session = await getPendingSession()
  return session.challenge ?? null
}

export async function hasActivePendingWorkOSMagicAuth(
  intent: WorkOSMagicIntent,
  now = Date.now(),
): Promise<boolean> {
  const challenge = await readPendingWorkOSMagicAuth()
  if (!challenge || challenge.intent !== intent) return false
  const expiresAt = Date.parse(challenge.expiresAt)
  return Number.isFinite(expiresAt) && expiresAt > now
}

export async function clearPendingWorkOSMagicAuth(): Promise<void> {
  const session = await getPendingSession()
  session.destroy()
}

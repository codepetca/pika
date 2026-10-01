import { ApiError } from '@/lib/api-error'
import { getSafeInternalPath } from '@/lib/navigation-safety'

export function isWorkOSMagicAuthPilotEnabled(): boolean {
  return process.env.WORKOS_MAGIC_AUTH_PILOT === 'true'
}

export function requireWorkOSMagicAuthPilot(): void {
  if (!isWorkOSMagicAuthPilotEnabled()) {
    throw new ApiError(404, 'Not found')
  }
}

/**
 * Guards the legacy email/password auth routes.
 *
 * While the WorkOS pilot is enabled, WorkOS is the credential authority and a
 * password-issued `pika_session` already authorizes nothing (see
 * `getCurrentUser` in `@/lib/auth`). Refusing these routes outright removes the
 * residual credential-verification oracle and the account-enumeration and
 * email-amplification surface they would otherwise keep exposed.
 *
 * Uses the same opaque 404 as `requireWorkOSMagicAuthPilot` so neither guard
 * reveals which auth flow an environment is running.
 */
export function requireLegacyPasswordAuth(): void {
  if (isWorkOSMagicAuthPilotEnabled()) {
    throw new ApiError(404, 'Not found')
  }
}

export function getWorkOSPilotConfig(): {
  clientId: string
  apiKey: string
  cookiePassword: string
} {
  const clientId = process.env.WORKOS_CLIENT_ID?.trim() ?? ''
  const apiKey = process.env.WORKOS_API_KEY?.trim() ?? ''
  const cookiePassword = process.env.WORKOS_COOKIE_PASSWORD ?? ''

  if (!clientId.startsWith('client_') || !apiKey.startsWith('sk_') || cookiePassword.length < 32) {
    throw new ApiError(503, 'Authentication is temporarily unavailable')
  }

  return { clientId, apiKey, cookiePassword }
}

export function safePikaPath(value: unknown, fallback = '/classrooms'): string {
  return getSafeInternalPath(value) ?? fallback
}

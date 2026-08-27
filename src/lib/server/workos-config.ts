import { ApiError } from '@/lib/api-error'
import {
  isLegacyPasswordAuthEnabled,
  isWorkOSMagicAuthEnabled,
} from '@/lib/auth-mode'
import { getSafeInternalPath } from '@/lib/navigation-safety'

export function requireLegacyPasswordAuth(): void {
  if (!isLegacyPasswordAuthEnabled()) {
    throw new ApiError(404, 'Not found')
  }
}

export function requireWorkOSMagicAuth(): void {
  if (!isWorkOSMagicAuthEnabled()) {
    throw new ApiError(404, 'Not found')
  }

  getWorkOSConfig()
}

export function getWorkOSConfig(): {
  clientId: string
  apiKey: string
  cookiePassword: string
} {
  const clientId = process.env.WORKOS_CLIENT_ID?.trim() ?? ''
  const apiKey = process.env.WORKOS_API_KEY?.trim() ?? ''
  const cookiePassword = process.env.WORKOS_COOKIE_PASSWORD ?? ''
  const sessionSecret = process.env.SESSION_SECRET ?? ''

  if (
    !clientId.startsWith('client_')
    || !apiKey.startsWith('sk_')
    || cookiePassword.length < 32
    || sessionSecret.length < 32
  ) {
    throw new ApiError(503, 'Authentication is temporarily unavailable')
  }

  return { clientId, apiKey, cookiePassword }
}

export function safePikaPath(value: unknown, fallback = '/classrooms'): string {
  return getSafeInternalPath(value) ?? fallback
}

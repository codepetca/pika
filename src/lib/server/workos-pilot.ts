import { ApiError } from '@/lib/api-error'
import { isSafeInternalPath } from '@/lib/navigation-safety'

export function isWorkOSMagicAuthPilotEnabled(): boolean {
  return process.env.WORKOS_MAGIC_AUTH_PILOT === 'true'
}

export function requireWorkOSMagicAuthPilot(): void {
  if (!isWorkOSMagicAuthPilotEnabled()) {
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
  return isSafeInternalPath(value) ? value.trim() : fallback
}

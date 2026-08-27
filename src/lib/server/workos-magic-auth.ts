import type { AuthenticationResponse } from '@workos-inc/node'
import { getWorkOS } from '@workos-inc/authkit-nextjs'
import { ApiError } from '@/lib/api-error'
import { getWorkOSConfig } from '@/lib/server/workos-config'
import {
  deliverWorkOSMagicAuthCode,
  getWorkOSMagicAuthEmailDelivery,
} from '@/lib/server/workos-magic-delivery'

export type PikaWorkOSAuthenticationResponse = AuthenticationResponse

type WorkOSAuthenticationWireExtension = {
  authkit_authorization_code?: unknown
  authkitAuthorizationCode?: unknown
}

function providerStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const status = 'status' in error ? error.status : 'statusCode' in error ? error.statusCode : null
  return typeof status === 'number' ? status : null
}

export function mapWorkOSMagicAuthError(error: unknown, phase: 'start' | 'verify'): never {
  const status = providerStatus(error)
  if (status === 429) {
    throw new ApiError(429, 'Too many code requests. Please try again later.')
  }
  if (phase === 'verify' && status !== null && status >= 400 && status < 500) {
    throw new ApiError(401, 'Invalid or expired code')
  }
  if (phase === 'start' && status !== null && status >= 400 && status < 500) {
    throw new ApiError(400, 'Unable to send a sign-in code to that email')
  }
  throw new ApiError(503, 'Authentication is temporarily unavailable')
}

function requestContext(request: Request): { ipAddress?: string; userAgent?: string } {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const realIp = request.headers.get('x-real-ip')?.trim()
  const userAgent = request.headers.get('user-agent')?.slice(0, 512).trim()
  return {
    ...(forwardedFor || realIp ? { ipAddress: forwardedFor || realIp } : {}),
    ...(userAgent ? { userAgent } : {}),
  }
}

export async function startWorkOSMagicAuth(email: string, request: Request): Promise<{
  expiresAt: string
  radarAuthAttemptId?: string
}> {
  getWorkOSConfig()
  const delivery = getWorkOSMagicAuthEmailDelivery()
  try {
    const result = await getWorkOS().userManagement.createMagicAuth({
      email,
      ...requestContext(request),
    })
    await deliverWorkOSMagicAuthCode({
      email,
      code: result.code,
      delivery,
    })
    return {
      expiresAt: result.expiresAt,
      ...(result.radarAuthAttemptId ? { radarAuthAttemptId: result.radarAuthAttemptId } : {}),
    }
  } catch (error) {
    mapWorkOSMagicAuthError(error, 'start')
  }
}

export async function verifyWorkOSMagicAuth(input: {
  email: string
  code: string
  radarAuthAttemptId?: string
  request: Request
}): Promise<PikaWorkOSAuthenticationResponse> {
  const { clientId } = getWorkOSConfig()
  try {
    const response = await getWorkOS().userManagement.authenticateWithMagicAuth({
      clientId,
      email: input.email,
      code: input.code,
      ...(input.radarAuthAttemptId ? { radarAuthAttemptId: input.radarAuthAttemptId } : {}),
      ...requestContext(input.request),
    })
    const extendedResponse = response as AuthenticationResponse & WorkOSAuthenticationWireExtension
    const {
      authkitAuthorizationCode: _camelCode,
      authkit_authorization_code: _wireCode,
      ...sessionResponse
    } = extendedResponse
    return sessionResponse as AuthenticationResponse
  } catch (error) {
    mapWorkOSMagicAuthError(error, 'verify')
  }
}

import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-handler'
import { destroySession } from '@/lib/auth'

export function getPikaLoginUrl(request: NextRequest): string {
  return new URL(
    '/login',
    process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin,
  ).toString()
}

export function requireSameOriginPost(request: NextRequest): void {
  const expectedOrigin = new URL(
    process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin,
  ).origin

  if (request.headers.get('origin') !== expectedOrigin) {
    throw new ApiError(403, 'Invalid request origin')
  }
}

export async function clearLocalAuthenticationState(): Promise<void> {
  await destroySession()

  const cookieStore = await cookies()
  const workOSCookieNames = new Set([
    process.env.WORKOS_COOKIE_NAME || 'wos-session',
    'wos-session',
    'pika-wos-session',
  ])
  for (const cookieName of workOSCookieNames) {
    cookieStore.delete(cookieName)
  }
  cookieStore.delete('pika_workos_magic')
}

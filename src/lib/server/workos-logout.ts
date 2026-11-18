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
  const expectedOrigin = request.nextUrl.origin
  const origin = request.headers.get('origin')

  if (origin === expectedOrigin) return

  // Next normalizes 127.0.0.1 to localhost in nextUrl. In development,
  // accept only the same HTTP loopback host and port the browser requested.
  const host = request.headers.get('host')
  const fetchSite = request.headers.get('sec-fetch-site')
  if (process.env.NODE_ENV === 'development' && host && origin === `http://${host}`
    && /^127\.0\.0\.1:\d+$/.test(host)
    && request.nextUrl.protocol === 'http:' && request.nextUrl.hostname === 'localhost'
    && request.nextUrl.port === host.slice('127.0.0.1:'.length)
    && fetchSite === 'same-origin') return

  const isPrivateSameOriginBrowserRequest = origin === 'null'
    && request.headers.get('sec-fetch-site') === 'same-origin'
  if (isPrivateSameOriginBrowserRequest) return

  throw new ApiError(403, 'Invalid request origin')
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

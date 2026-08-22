import { getWorkOS, withAuth } from '@workos-inc/authkit-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { destroySession } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { isWorkOSMagicAuthPilotEnabled } from '@/lib/server/workos-pilot'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetWorkOSLogout', async (request: NextRequest) => {
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

  const returnTo = new URL(
    '/login',
    process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin,
  ).toString()

  if (!isWorkOSMagicAuthPilotEnabled()) {
    return NextResponse.redirect(returnTo)
  }

  const { sessionId } = await withAuth()
  const logoutUrl = sessionId
    ? getWorkOS().userManagement.getLogoutUrl({ sessionId, returnTo })
    : returnTo

  // WorkOS invalidates the server-side session when the browser follows this
  // URL. The local cookies are already gone even if no WorkOS session remains.
  return NextResponse.redirect(logoutUrl)
})

import { NextResponse } from 'next/server'
import { destroySession } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { cookies } from 'next/headers'
import { isWorkOSMagicAuthPilotEnabled } from '@/lib/server/workos-pilot'

export const POST = withErrorHandler('PostLogout', async () => {
  await destroySession()

  if (isWorkOSMagicAuthPilotEnabled()) {
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

  return NextResponse.json({
    success: true,
    message: 'Logged out successfully',
  })
})

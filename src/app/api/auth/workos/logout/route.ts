import { getWorkOS, withAuth } from '@workos-inc/authkit-nextjs'
import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { isWorkOSMagicAuthPilotEnabled } from '@/lib/server/workos-pilot'
import {
  clearLocalAuthenticationState,
  getPikaLoginUrl,
  requireSameOriginPost,
} from '@/lib/server/workos-logout'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostWorkOSLogout', async (request: NextRequest) => {
  requireSameOriginPost(request)
  const returnTo = getPikaLoginUrl(request)
  let logoutUrl = returnTo

  try {
    if (isWorkOSMagicAuthPilotEnabled()) {
      const { sessionId } = await withAuth()
      if (sessionId) {
        logoutUrl = getWorkOS().userManagement.getLogoutUrl({ sessionId, returnTo })
      }
    }
  } finally {
    await clearLocalAuthenticationState()
  }

  // WorkOS invalidates the server-side session when the browser follows this
  // URL. A 303 converts the form POST into the provider's GET logout request.
  return NextResponse.redirect(logoutUrl, 303)
})

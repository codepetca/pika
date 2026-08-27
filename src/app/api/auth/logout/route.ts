import { getWorkOS, withAuth } from '@workos-inc/authkit-nextjs'
import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import {
  clearLocalAuthenticationState,
  requireSameOriginPost,
} from '@/lib/server/workos-logout'
import { shouldUseWorkOSAuthKit } from '@/lib/auth-mode'

export const POST = withErrorHandler('PostLogout', async (request: NextRequest) => {
  requireSameOriginPost(request)

  try {
    if (shouldUseWorkOSAuthKit()) {
      const { sessionId } = await withAuth()
      if (sessionId) {
        await getWorkOS().userManagement.revokeSession({ sessionId })
      }
    }
  } finally {
    // Local state is cleared even when WorkOS is unavailable. Provider errors
    // still propagate so legacy callers are never told that logout succeeded.
    await clearLocalAuthenticationState()
  }

  return NextResponse.json({
    success: true,
    message: 'Logged out successfully',
  })
})

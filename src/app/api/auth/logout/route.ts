import { getWorkOS, withAuth } from '@workos-inc/authkit-nextjs'
import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { clearLocalAuthenticationState } from '@/lib/server/workos-logout'
import { isWorkOSMagicAuthPilotEnabled } from '@/lib/server/workos-pilot'

export const POST = withErrorHandler('PostLogout', async () => {
  try {
    if (isWorkOSMagicAuthPilotEnabled()) {
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

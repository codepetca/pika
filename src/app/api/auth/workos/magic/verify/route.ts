import { NextRequest, NextResponse } from 'next/server'
import { saveSession } from '@workos-inc/authkit-nextjs'
import { createSession } from '@/lib/auth'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { resolvePikaUserFromWorkOS } from '@/lib/server/workos-identity'
import { verifyWorkOSMagicAuth } from '@/lib/server/workos-magic-auth'
import {
  clearPendingWorkOSMagicAuth,
  readPendingWorkOSMagicAuth,
} from '@/lib/server/workos-magic-pending'
import { requireWorkOSMagicAuthPilot, safePikaPath } from '@/lib/server/workos-pilot'
import { verifyWorkOSMagicAuthSchema } from '@/lib/validations/auth'

export const POST = withErrorHandler('VerifyWorkOSMagicAuth', async (request: NextRequest) => {
  requireWorkOSMagicAuthPilot()
  const { code } = verifyWorkOSMagicAuthSchema.parse(await request.json())
  const pending = await readPendingWorkOSMagicAuth()

  if (!pending || !Number.isFinite(Date.parse(pending.expiresAt))) {
    throw new ApiError(401, 'Start a new sign-in code request')
  }
  if (Date.parse(pending.expiresAt) <= Date.now()) {
    await clearPendingWorkOSMagicAuth()
    throw new ApiError(401, 'Invalid or expired code')
  }

  const authResponse = await verifyWorkOSMagicAuth({
    email: pending.email,
    code,
    radarAuthAttemptId: pending.radarAuthAttemptId,
    request,
  })
  const returnedEmail = authResponse.user.email.trim().toLowerCase()
  if (returnedEmail !== pending.email || !authResponse.user.emailVerified) {
    throw new ApiError(409, 'Account identity conflict')
  }

  const pikaUser = await resolvePikaUserFromWorkOS(authResponse.user)

  // WorkOS is the credential/session authority. The Pika session remains an
  // internal identity/role mapping for existing requireAuth()/requireRole().
  // Save WorkOS first so a failure cannot leave only a Pika-authenticated user.
  await saveSession(authResponse, request)
  await createSession(pikaUser.id, pikaUser.email, pikaUser.role, {
    workosUserId: authResponse.user.id,
  })
  await clearPendingWorkOSMagicAuth()

  const nextPath = safePikaPath(pending.nextPath)
  return NextResponse.json(
    {
      success: true,
      redirectUrl: nextPath,
      user: {
        id: pikaUser.id,
        email: pikaUser.email,
        role: pikaUser.role,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
})

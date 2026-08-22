import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@workos-inc/authkit-nextjs'
import { createSession } from '@/lib/auth'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { findLinkedPikaUserFromWorkOS } from '@/lib/server/workos-identity'
import { requireWorkOSMagicAuthPilot, safePikaPath } from '@/lib/server/workos-pilot'
import { restoreWorkOSSessionSchema } from '@/lib/validations/auth'

export const POST = withErrorHandler('RestoreWorkOSSession', async (request: NextRequest) => {
  const input = restoreWorkOSSessionSchema.parse(await request.json())
  requireWorkOSMagicAuthPilot()

  const { user: workosUser } = await withAuth()
  if (!workosUser?.emailVerified) {
    throw new ApiError(401, 'Not authenticated')
  }

  const pikaUser = await findLinkedPikaUserFromWorkOS(workosUser)
  if (!pikaUser) {
    throw new ApiError(409, 'Account identity conflict')
  }

  await createSession(pikaUser.id, pikaUser.email, pikaUser.role, {
    workosUserId: workosUser.id,
    recordAuthenticationEvent: false,
  })

  return NextResponse.json(
    { redirectUrl: safePikaPath(input.next) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
})

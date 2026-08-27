import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { startWorkOSMagicAuthSchema } from '@/lib/validations/auth'
import { startWorkOSMagicAuth } from '@/lib/server/workos-magic-auth'
import { savePendingWorkOSMagicAuth } from '@/lib/server/workos-magic-pending'
import { requireWorkOSMagicAuth, safePikaPath } from '@/lib/server/workos-config'

export const POST = withErrorHandler('StartWorkOSMagicAuth', async (request: NextRequest) => {
  requireWorkOSMagicAuth()
  const input = startWorkOSMagicAuthSchema.parse(await request.json())
  const challenge = await startWorkOSMagicAuth(input.email, request)

  if (!Number.isFinite(Date.parse(challenge.expiresAt))) {
    throw new Error('WorkOS returned an invalid Magic Auth expiry')
  }

  await savePendingWorkOSMagicAuth({
    email: input.email,
    expiresAt: challenge.expiresAt,
    intent: input.intent,
    nextPath: safePikaPath(input.next),
    ...(challenge.radarAuthAttemptId
      ? { radarAuthAttemptId: challenge.radarAuthAttemptId }
      : {}),
  })

  return NextResponse.json(
    {
      success: true,
      message: 'Sign-in code sent',
      expiresAt: challenge.expiresAt,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
})

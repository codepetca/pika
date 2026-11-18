import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { startWorkOSMagicAuthSchema } from '@/lib/validations/auth'
import { consumeAuthRequestRateLimits } from '@/lib/server/auth-rate-limit'
import { scheduleClassroomLaunchAlert } from '@/lib/server/classroom-launch-alerts'
import { startWorkOSMagicAuth } from '@/lib/server/workos-magic-auth'
import { savePendingWorkOSMagicAuth } from '@/lib/server/workos-magic-pending'
import { requireWorkOSMagicAuthPilot, safePikaPath } from '@/lib/server/workos-pilot'

const MAX_CODES_PER_EMAIL_PER_HOUR = 5
const MAX_CODES_PER_CLIENT_PER_HOUR = 90

export const POST = withErrorHandler('StartWorkOSMagicAuth', async (request: NextRequest) => {
  requireWorkOSMagicAuthPilot()
  const input = startWorkOSMagicAuthSchema.parse(await request.json())
  // Signup and sign-in issue the same code, so both use the same budgets.
  await consumeAuthRequestRateLimits({
    action: 'workos_code',
    request,
    identifier: input.email,
    identifierMaxAttempts: MAX_CODES_PER_EMAIL_PER_HOUR,
    clientMaxAttempts: MAX_CODES_PER_CLIENT_PER_HOUR,
    windowSeconds: 60 * 60,
  })
  const challenge = await startWorkOSMagicAuth(input.email, request)

  if (!Number.isFinite(Date.parse(challenge.expiresAt))) {
    scheduleClassroomLaunchAlert('signup-email')
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

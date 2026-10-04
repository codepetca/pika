import { NextRequest, NextResponse } from 'next/server'
import { requirePasswordSessionRequest } from '@/lib/server/password-session-boundary'
import { logServerError } from '@/lib/server/diagnostics'
import { getServiceRoleClient } from '@/lib/supabase'
import { hashHandoffToken, hashPassword } from '@/lib/crypto'
import { createSession } from '@/lib/auth'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { createPasswordSchema } from '@/lib/validations/auth'
import { consumeAuthRequestRateLimits } from '@/lib/server/auth-rate-limit'
import {
  consumeSignupPasswordHandoff,
  inspectLatestAuthHandoff,
} from '@/lib/server/auth-verification-generation'

export const POST = withErrorHandler('CreatePassword', async (request: NextRequest) => {
  requirePasswordSessionRequest(request)
  const { email: normalizedEmail, password, handoffToken } = createPasswordSchema.parse(await request.json())

  const supabase = getServiceRoleClient()

  await consumeAuthRequestRateLimits({
    action: 'signup_confirm',
    request,
    identifier: normalizedEmail,
    identifierMaxAttempts: 5,
    clientMaxAttempts: 30,
    windowSeconds: 10 * 60,
    supabase,
  })

  const handoffTokenHash = hashHandoffToken(handoffToken)
  const { handoff, error: handoffError } = await inspectLatestAuthHandoff(supabase, {
    purpose: 'signup',
    handoffTokenHash,
  })

  if (handoffError) {
    logServerError('auth.verify', handoffError)
    throw new ApiError(500, 'Failed to create password')
  }

  if (
    !handoff
    || handoff.email.trim().toLowerCase() !== normalizedEmail
    || !handoff.email_verified
    || handoff.password_set
  ) {
    throw new ApiError(401, 'Verification session expired. Please verify your email again.')
  }

  // Hash password
  const passwordHash = await hashPassword(password)

  const { credentialVersion, error: updateError } = await consumeSignupPasswordHandoff(supabase, {
    userId: handoff.user_id,
    generation: handoff.generation,
    handoffTokenHash,
    passwordHash,
    expectedCredentialVersion: handoff.credential_version,
  })

  if (updateError) {
    logServerError('auth.verify', updateError)
    throw new ApiError(500, 'Failed to create password')
  }

  if (!credentialVersion) {
    throw new ApiError(401, 'Verification session expired. Please verify your email again.')
  }

  // Session issuance rejects a credential epoch changed after the winning write.
  await createSession(handoff.user_id, handoff.email, handoff.role, {
    expectedCredentialVersion: credentialVersion,
  })

  const redirectUrl = '/classrooms'

  return NextResponse.json({
    success: true,
    message: 'Password created successfully',
    redirectUrl,
    user: {
      id: handoff.user_id,
      email: handoff.email,
      role: handoff.role,
    },
  })
})

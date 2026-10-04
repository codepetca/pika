import { NextRequest, NextResponse } from 'next/server'
import { requirePasswordSessionRequest } from '@/lib/server/password-session-boundary'
import { logServerError } from '@/lib/server/diagnostics'
import { getServiceRoleClient } from '@/lib/supabase'
import { hashHandoffToken, hashPassword } from '@/lib/crypto'
import { createSession } from '@/lib/auth'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { resetPasswordConfirmSchema } from '@/lib/validations/auth'
import { consumeAuthRequestRateLimits } from '@/lib/server/auth-rate-limit'
import {
  consumeLatestPasswordReset,
  inspectLatestAuthHandoff,
} from '@/lib/server/auth-verification-generation'

const INVALID_RESET_SESSION = 'Password reset session expired. Please request a new code.'

export const POST = withErrorHandler('ResetPasswordConfirm', async (request: NextRequest) => {
  requirePasswordSessionRequest(request)
  const { email: normalizedEmail, password, handoffToken } = resetPasswordConfirmSchema.parse(await request.json())

  const supabase = getServiceRoleClient()

  await consumeAuthRequestRateLimits({
    action: 'reset_confirm',
    request,
    identifier: normalizedEmail,
    identifierMaxAttempts: 5,
    clientMaxAttempts: 30,
    windowSeconds: 10 * 60,
    supabase,
  })

  const handoffTokenHash = hashHandoffToken(handoffToken)
  const { handoff, error: handoffError } = await inspectLatestAuthHandoff(supabase, {
    purpose: 'reset_password',
    handoffTokenHash,
  })
  if (
    handoffError
    || !handoff
    || handoff.email.trim().toLowerCase() !== normalizedEmail
    || !handoff.password_set
  ) {
    throw new ApiError(401, INVALID_RESET_SESSION)
  }

  // Hash only after proving possession of the 256-bit handoff. Invalid public
  // requests cannot force unbounded bcrypt work.
  const passwordHash = await hashPassword(password)
  const { credentialVersion, error: resetError } = await consumeLatestPasswordReset(supabase, {
    userId: handoff.user_id,
    generation: handoff.generation,
    handoffTokenHash,
    passwordHash,
  })

  if (resetError) {
    logServerError('auth.reset', resetError)
    throw new ApiError(500, 'Failed to reset password')
  }
  if (!credentialVersion) {
    throw new ApiError(401, INVALID_RESET_SESSION)
  }

  // Create new session
  await createSession(handoff.user_id, handoff.email, handoff.role, {
    expectedCredentialVersion: credentialVersion,
  })

  const redirectUrl = '/classrooms'

  return NextResponse.json({
    success: true,
    message: 'Password reset successfully',
    redirectUrl,
    user: {
      id: handoff.user_id,
      email: handoff.email,
      role: handoff.role,
    },
  })
})

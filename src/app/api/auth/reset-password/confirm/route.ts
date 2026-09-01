import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { hashHandoffToken, hashPassword } from '@/lib/crypto'
import { createSession } from '@/lib/auth'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { resetPasswordConfirmSchema } from '@/lib/validations/auth'
import { consumeAuthRequestRateLimits } from '@/lib/server/auth-rate-limit'

const INVALID_RESET_SESSION = 'Password reset session expired. Please request a new code.'

export const POST = withErrorHandler('ResetPasswordConfirm', async (request: NextRequest) => {
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
  const now = new Date().toISOString()
  const { data: handoff, error: handoffError } = await supabase
    .from('verification_codes')
    .select('user_id, users!inner(id, email, role)')
    .eq('purpose', 'reset_password')
    .eq('handoff_token_hash', handoffTokenHash)
    .is('handoff_consumed_at', null)
    .gt('handoff_expires_at', now)
    .maybeSingle()

  const user = handoff?.users
  if (
    handoffError
    || !handoff
    || !user
    || user.email.trim().toLowerCase() !== normalizedEmail
    || (user.role !== 'student' && user.role !== 'teacher')
  ) {
    throw new ApiError(401, INVALID_RESET_SESSION)
  }

  // Hash only after proving possession of the 256-bit handoff. Invalid public
  // requests cannot force unbounded bcrypt work.
  const passwordHash = await hashPassword(password)
  const { data: credentialVersion, error: resetError } = await supabase.rpc(
    'consume_password_reset_and_revoke_sessions',
    {
      p_user_id: handoff.user_id,
      p_handoff_token_hash: handoffTokenHash,
      p_password_hash: passwordHash,
    },
  )

  if (resetError) {
    console.error('Error resetting password and revoking sessions:', resetError)
    throw new ApiError(500, 'Failed to reset password')
  }
  if (!credentialVersion) {
    throw new ApiError(401, INVALID_RESET_SESSION)
  }

  // Create new session
  await createSession(user.id, user.email, user.role, {
    expectedCredentialVersion: credentialVersion,
  })

  const redirectUrl = '/classrooms'

  return NextResponse.json({
    success: true,
    message: 'Password reset successfully',
    redirectUrl,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  })
})

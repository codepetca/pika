import { NextRequest, NextResponse } from 'next/server'
import { logServerError } from '@/lib/server/diagnostics'
import { getServiceRoleClient } from '@/lib/supabase'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { resetPasswordVerifySchema } from '@/lib/validations/auth'
import { consumeAuthRequestRateLimits } from '@/lib/server/auth-rate-limit'
import { verifyAuthCodeAndIssueHandoff } from '@/lib/server/auth-verification-generation'

const MAX_VERIFICATION_ATTEMPTS = 5
const HANDOFF_TOKEN_TTL_MS = 10 * 60 * 1000
const INVALID_VERIFICATION_MESSAGE = 'Invalid email or code'
const NONEXISTENT_USER_ID = '00000000-0000-0000-0000-000000000000'

export const POST = withErrorHandler('ResetPasswordVerify', async (request: NextRequest) => {
  const { email: normalizedEmail, code: normalizedCode } = resetPasswordVerifySchema.parse(await request.json())

  const supabase = getServiceRoleClient()

  await consumeAuthRequestRateLimits({
    action: 'reset_verify',
    request,
    identifier: normalizedEmail,
    identifierMaxAttempts: MAX_VERIFICATION_ATTEMPTS,
    clientMaxAttempts: 60,
    windowSeconds: 10 * 60,
    supabase,
  })

  // Find user by email
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, email, password_hash')
    .eq('email', normalizedEmail)
    .single()

  const eligibleUser = !userError && user?.password_hash ? user : null

  const verification = await verifyAuthCodeAndIssueHandoff(supabase, {
    userId: eligibleUser?.id || NONEXISTENT_USER_ID,
    purpose: 'reset_password',
    code: normalizedCode,
    maxAttempts: MAX_VERIFICATION_ATTEMPTS,
    handoffTtlMs: HANDOFF_TOKEN_TTL_MS,
  })
  if (verification.error) {
    logServerError('auth.reset', verification.error)
    throw new ApiError(500, 'Internal server error')
  }
  if (!eligibleUser || !verification.handoffToken) {
    throw new ApiError(401, INVALID_VERIFICATION_MESSAGE)
  }

  return NextResponse.json({
    success: true,
    message: 'Code verified successfully',
    userId: eligibleUser.id,
    handoffToken: verification.handoffToken,
  })
})

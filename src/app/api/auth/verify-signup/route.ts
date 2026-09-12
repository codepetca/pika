import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { generateHandoffToken, hashHandoffToken, verifyCode } from '@/lib/crypto'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { requireLegacyPasswordAuth } from '@/lib/server/workos-pilot'
import { verifySignupSchema } from '@/lib/validations/auth'
import { consumeAuthRequestRateLimits } from '@/lib/server/auth-rate-limit'
import { DUMMY_AUTH_BCRYPT_HASH } from '@/lib/server/auth-response'

const MAX_VERIFICATION_ATTEMPTS = 5
const HANDOFF_TOKEN_TTL_MS = 10 * 60 * 1000
const INVALID_VERIFICATION_MESSAGE = 'Invalid email or code'
const NONEXISTENT_USER_ID = '00000000-0000-0000-0000-000000000000'
const NONEXISTENT_CODE_ID = '00000000-0000-0000-0000-000000000001'

export const POST = withErrorHandler('VerifySignup', async (request: NextRequest) => {
  requireLegacyPasswordAuth()
  const { email: normalizedEmail, code: normalizedCode } = verifySignupSchema.parse(await request.json())

  const supabase = getServiceRoleClient()

  await consumeAuthRequestRateLimits({
    action: 'signup_verify',
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

  const eligibleUser = !userError && user && !user.password_hash ? user : null

  // Always perform the same code lookup and one bcrypt comparison. Only the
  // latest code is valid after a resend, which also prevents code-count timing.
  const { data: codes, error: fetchError } = await supabase
    .from('verification_codes')
    .select('*')
    .eq('user_id', eligibleUser?.id || NONEXISTENT_USER_ID)
    .eq('purpose', 'signup')
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })

  if (fetchError) {
    console.error('Error fetching verification codes:', fetchError)
    throw new ApiError(500, 'Internal server error')
  }

  const candidateCode = codes?.[0]
  const candidateUsable = candidateCode
    && candidateCode.attempts < MAX_VERIFICATION_ATTEMPTS
  const isValid = await verifyCode(
    normalizedCode,
    candidateUsable ? candidateCode.code_hash : DUMMY_AUTH_BCRYPT_HASH,
  )

  if (!eligibleUser || !candidateUsable || !isValid) {
    const shouldIncrementCandidate = Boolean(
      eligibleUser && candidateCode && candidateCode.attempts < MAX_VERIFICATION_ATTEMPTS,
    )
    await supabase
      .from('verification_codes')
      .update({ attempts: shouldIncrementCandidate ? candidateCode!.attempts + 1 : 1 })
      .eq('id', shouldIncrementCandidate ? candidateCode!.id : NONEXISTENT_CODE_ID)
    throw new ApiError(401, INVALID_VERIFICATION_MESSAGE)
  }

  const usedAt = new Date()
  const handoffToken = generateHandoffToken()
  const { data: markedCode, error: markCodeError } = await supabase
    .from('verification_codes')
    .update({
      used_at: usedAt.toISOString(),
      handoff_token_hash: hashHandoffToken(handoffToken),
      handoff_expires_at: new Date(usedAt.getTime() + HANDOFF_TOKEN_TTL_MS).toISOString(),
      handoff_consumed_at: null,
    })
    .eq('id', candidateCode.id)
    .is('used_at', null)
    .select('id')
    .maybeSingle()

  if (markCodeError) {
    console.error('Error marking verification code as used:', markCodeError)
    throw new ApiError(500, 'Internal server error')
  }

  if (!markedCode) {
    throw new ApiError(401, INVALID_VERIFICATION_MESSAGE)
  }

  const { error: verifyEmailError } = await supabase
    .from('users')
    .update({ email_verified_at: usedAt.toISOString() })
    .eq('id', eligibleUser.id)

  if (verifyEmailError) {
    console.error('Error marking email as verified:', verifyEmailError)
    throw new ApiError(500, 'Internal server error')
  }

  return NextResponse.json({
    success: true,
    message: 'Email verified successfully',
    userId: eligibleUser.id,
    handoffToken,
  })
})

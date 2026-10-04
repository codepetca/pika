import { NextRequest, NextResponse } from 'next/server'
import { logServerError } from '@/lib/server/diagnostics'
import { getServiceRoleClient } from '@/lib/supabase'
import { generateHandoffToken, hashHandoffToken, verifyCode } from '@/lib/crypto'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { resetPasswordVerifySchema } from '@/lib/validations/auth'
import { consumeAuthRequestRateLimits } from '@/lib/server/auth-rate-limit'
import { DUMMY_AUTH_BCRYPT_HASH } from '@/lib/server/auth-response'

const MAX_VERIFICATION_ATTEMPTS = 5
const HANDOFF_TOKEN_TTL_MS = 10 * 60 * 1000
const INVALID_VERIFICATION_MESSAGE = 'Invalid email or code'
const NONEXISTENT_USER_ID = '00000000-0000-0000-0000-000000000000'
const NONEXISTENT_CODE_ID = '00000000-0000-0000-0000-000000000001'

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

  // Always perform the same code lookup and one bcrypt comparison. Only the
  // newest issuance remains authoritative even when used or expired.
  const { data: codes, error: fetchError } = await supabase
    .from('verification_codes')
    .select('id, code_hash, attempts, used_at, expires_at')
    .eq('user_id', eligibleUser?.id || NONEXISTENT_USER_ID)
    .eq('purpose', 'reset_password')
    .order('created_at', { ascending: false })

  if (fetchError) {
    logServerError('auth.reset', fetchError)
    throw new ApiError(500, 'Internal server error')
  }

  const candidateCode = codes?.[0]
  const candidateUsable = candidateCode
    && candidateCode.used_at === null
    && Date.parse(candidateCode.expires_at) > Date.now()
    && candidateCode.attempts < MAX_VERIFICATION_ATTEMPTS
  const isValid = await verifyCode(
    normalizedCode,
    candidateUsable ? candidateCode.code_hash : DUMMY_AUTH_BCRYPT_HASH,
  )

  // A resend may finish while bcrypt runs. Re-read the newest issuance for
  // every result so that a completed resend cannot mint an older handoff.
  // Issuance and consumption still need a DB transaction for full serialization.
  const { data: currentCodes, error: currentFetchError } = await supabase
    .from('verification_codes')
    .select('id')
    .eq('user_id', eligibleUser?.id || NONEXISTENT_USER_ID)
    .eq('purpose', 'reset_password')
    .order('created_at', { ascending: false })

  if (currentFetchError) {
    logServerError('auth.verify', currentFetchError)
    throw new ApiError(500, 'Internal server error')
  }

  const candidateStillLatest = candidateCode && currentCodes?.[0]?.id === candidateCode.id
  if (!eligibleUser || !candidateUsable || !isValid || !candidateStillLatest) {
    const shouldIncrementCandidate = Boolean(
      eligibleUser && candidateUsable && candidateStillLatest,
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
    logServerError('auth.reset', markCodeError)
    throw new ApiError(500, 'Internal server error')
  }

  if (!markedCode) {
    throw new ApiError(401, INVALID_VERIFICATION_MESSAGE)
  }

  return NextResponse.json({
    success: true,
    message: 'Code verified successfully',
    userId: eligibleUser.id,
    handoffToken,
  })
})

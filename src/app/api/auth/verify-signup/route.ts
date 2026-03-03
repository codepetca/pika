import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { verifyCode } from '@/lib/crypto'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { verifySignupSchema } from '@/lib/validations/auth'

const MAX_VERIFICATION_ATTEMPTS = 5

export const POST = withErrorHandler('VerifySignup', async (request: NextRequest) => {
  const { email: normalizedEmail, code: normalizedCode } = verifySignupSchema.parse(await request.json())

  const supabase = getServiceRoleClient()

  // Find user by email
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, email, password_hash')
    .eq('email', normalizedEmail)
    .single()

  if (userError || !user) {
    throw new ApiError(401, 'Invalid email or code')
  }

  // Check if user already has a password
  if (user.password_hash) {
    throw new ApiError(400, 'This account already has a password. Please login instead.')
  }

  // Find unused, non-expired verification codes for this user
  const { data: codes, error: fetchError } = await supabase
    .from('verification_codes')
    .select('*')
    .eq('user_id', user.id)
    .eq('purpose', 'signup')
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })

  if (fetchError) {
    console.error('Error fetching verification codes:', fetchError)
    throw new ApiError(500, 'Internal server error')
  }

  if (!codes || codes.length === 0) {
    throw new ApiError(401, 'Invalid or expired code')
  }

  // Try to verify against each code (most recent first)
  let validCode = null

  for (const codeRecord of codes) {
    // Check if too many attempts
    if (codeRecord.attempts >= MAX_VERIFICATION_ATTEMPTS) {
      continue
    }

    // Verify code hash
    const isValid = await verifyCode(normalizedCode, codeRecord.code_hash)

    if (isValid) {
      validCode = codeRecord
      break
    } else {
      // Increment attempts
      await supabase
        .from('verification_codes')
        .update({ attempts: codeRecord.attempts + 1 })
        .eq('id', codeRecord.id)
    }
  }

  if (!validCode) {
    throw new ApiError(401, 'Invalid code')
  }

  // Mark code as used and verify email
  await supabase
    .from('verification_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('id', validCode.id)

  await supabase
    .from('users')
    .update({ email_verified_at: new Date().toISOString() })
    .eq('id', user.id)

  return NextResponse.json({
    success: true,
    message: 'Email verified successfully',
    userId: user.id,
  })
})

import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { generateVerificationCode, hashCode } from '@/lib/crypto'
import { isTeacherEmail } from '@/lib/auth'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { requireLegacyPasswordAuth } from '@/lib/server/workos-pilot'
import { signupSchema } from '@/lib/validations/auth'
import { consumeAuthRequestRateLimits } from '@/lib/server/auth-rate-limit'
import {
  completeAuthResponseFloor,
  scheduleSignupCode,
} from '@/lib/server/auth-response'

const MAX_CODES_PER_HOUR = 5
const CODE_EXPIRY_MINUTES = 10
const SIGNUP_RESPONSE = {
  success: true,
  message: 'Verification code sent to your email',
}

export const POST = withErrorHandler('Signup', async (request: NextRequest) => {
  requireLegacyPasswordAuth()
  const startedAtMs = Date.now()
  const { email: normalizedEmail } = signupSchema.parse(await request.json())

  const supabase = getServiceRoleClient()

  await consumeAuthRequestRateLimits({
    action: 'signup_code',
    request,
    identifier: normalizedEmail,
    identifierMaxAttempts: MAX_CODES_PER_HOUR,
    clientMaxAttempts: 25,
    windowSeconds: 60 * 60,
    supabase,
  })

  // Pay the same password-hash work before account-state decisions. Delivery
  // is scheduled after the response so provider latency cannot become an
  // account-enumeration oracle.
  const code = generateVerificationCode()
  const codeHash = await hashCode(code)
  const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000)

  // Check if user already exists with a password
  const { data: existingUser } = await supabase
    .from('users')
    .select('id, email, password_hash, email_verified_at')
    .eq('email', normalizedEmail)
    .single()

  if (existingUser && existingUser.password_hash) {
    await completeAuthResponseFloor(startedAtMs)
    return NextResponse.json(SIGNUP_RESPONSE)
  }

  // Create user if doesn't exist (or update existing user without password)
  let userId: string

  if (existingUser) {
    userId = existingUser.id
  } else {
    // Determine role
    const role = isTeacherEmail(normalizedEmail) ? 'teacher' : 'student'

    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({
        email: normalizedEmail,
        role,
      })
      .select('id')
      .single()

    if (createError) {
      console.error('Error creating user:', createError)
      throw new ApiError(500, 'Failed to create user')
    }

    userId = newUser!.id
  }

  // Store hashed code
  const { error: insertError } = await supabase
    .from('verification_codes')
    .insert({
      user_id: userId,
      code_hash: codeHash,
      purpose: 'signup',
      expires_at: expiresAt.toISOString(),
      attempts: 0,
    })

  if (insertError) {
    console.error('Error inserting verification code:', insertError)
    throw new ApiError(500, 'Failed to generate code')
  }

  scheduleSignupCode(normalizedEmail, code)

  await completeAuthResponseFloor(startedAtMs)
  return NextResponse.json(SIGNUP_RESPONSE)
})

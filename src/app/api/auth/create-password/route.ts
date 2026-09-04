import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { hashHandoffToken, hashPassword } from '@/lib/crypto'
import { createSession } from '@/lib/auth'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { requireLegacyPasswordAuth } from '@/lib/server/workos-pilot'
import { createPasswordSchema } from '@/lib/validations/auth'
import { consumeAuthRequestRateLimits } from '@/lib/server/auth-rate-limit'

export const POST = withErrorHandler('CreatePassword', async (request: NextRequest) => {
  requireLegacyPasswordAuth()
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

  // Find user by email
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, email, role, email_verified_at, password_hash, auth_credential_version')
    .eq('email', normalizedEmail)
    .single()

  if (userError || !user) {
    throw new ApiError(401, 'Verification session expired. Please verify your email again.')
  }

  // Check if user already has a password
  if (user.password_hash) {
    throw new ApiError(401, 'Verification session expired. Please verify your email again.')
  }

  // Check if email is verified
  if (!user.email_verified_at) {
    throw new ApiError(401, 'Verification session expired. Please verify your email again.')
  }

  const now = new Date().toISOString()
  const { data: consumedHandoff, error: handoffError } = await supabase
    .from('verification_codes')
    .update({ handoff_consumed_at: now })
    .eq('user_id', user.id)
    .eq('purpose', 'signup')
    .eq('handoff_token_hash', hashHandoffToken(handoffToken))
    .is('handoff_consumed_at', null)
    .gt('handoff_expires_at', now)
    .select('id')
    .maybeSingle()

  if (handoffError) {
    console.error('Error consuming password handoff token:', handoffError)
    throw new ApiError(500, 'Failed to create password')
  }

  if (!consumedHandoff) {
    throw new ApiError(401, 'Verification session expired. Please verify your email again.')
  }

  // Hash password
  const passwordHash = await hashPassword(password)

  // Save password to user record
  const { error: updateError } = await supabase
    .from('users')
    .update({ password_hash: passwordHash })
    .eq('id', user.id)

  if (updateError) {
    console.error('Error updating password:', updateError)
    throw new ApiError(500, 'Failed to create password')
  }

  // Create session
  await createSession(user.id, user.email, user.role, {
    expectedCredentialVersion: user.auth_credential_version,
  })

  const redirectUrl = '/classrooms'

  return NextResponse.json({
    success: true,
    message: 'Password created successfully',
    redirectUrl,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  })
})

import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { hashHandoffToken, hashPassword } from '@/lib/crypto'
import { createSession } from '@/lib/auth'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { createPasswordSchema } from '@/lib/validations/auth'

export const POST = withErrorHandler('CreatePassword', async (request: NextRequest) => {
  const { email: normalizedEmail, password, handoffToken } = createPasswordSchema.parse(await request.json())

  const supabase = getServiceRoleClient()

  // Find user by email
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, email, role, email_verified_at, password_hash')
    .eq('email', normalizedEmail)
    .single()

  if (userError || !user) {
    throw new ApiError(404, 'User not found')
  }

  // Check if user already has a password
  if (user.password_hash) {
    throw new ApiError(400, 'This account already has a password')
  }

  // Check if email is verified
  if (!user.email_verified_at) {
    throw new ApiError(400, 'Email must be verified before creating a password')
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
  await createSession(user.id, user.email, user.role)

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

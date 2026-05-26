import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { hashHandoffToken, hashPassword } from '@/lib/crypto'
import { createSession } from '@/lib/auth'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { resetPasswordConfirmSchema } from '@/lib/validations/auth'

export const POST = withErrorHandler('ResetPasswordConfirm', async (request: NextRequest) => {
  const { email: normalizedEmail, password, handoffToken } = resetPasswordConfirmSchema.parse(await request.json())

  const supabase = getServiceRoleClient()

  // Find user by email
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, email, role')
    .eq('email', normalizedEmail)
    .single()

  if (userError || !user) {
    throw new ApiError(404, 'User not found')
  }

  const now = new Date().toISOString()
  const { data: consumedHandoff, error: handoffError } = await supabase
    .from('verification_codes')
    .update({ handoff_consumed_at: now })
    .eq('user_id', user.id)
    .eq('purpose', 'reset_password')
    .eq('handoff_token_hash', hashHandoffToken(handoffToken))
    .is('handoff_consumed_at', null)
    .gt('handoff_expires_at', now)
    .select('id')
    .maybeSingle()

  if (handoffError) {
    console.error('Error consuming reset handoff token:', handoffError)
    throw new ApiError(500, 'Failed to reset password')
  }

  if (!consumedHandoff) {
    throw new ApiError(401, 'Password reset session expired. Please request a new code.')
  }

  // Hash password
  const passwordHash = await hashPassword(password)

  // Update password
  const { error: updateError } = await supabase
    .from('users')
    .update({ password_hash: passwordHash })
    .eq('id', user.id)

  if (updateError) {
    console.error('Error updating password:', updateError)
    throw new ApiError(500, 'Failed to reset password')
  }

  // Optionally: Invalidate all existing sessions for this user
  // This would require implementing session tracking in the database

  // Create new session
  await createSession(user.id, user.email, user.role)

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

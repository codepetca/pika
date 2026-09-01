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
    throw new ApiError(401, 'Password reset session expired. Please request a new code.')
  }

  const passwordHash = await hashPassword(password)
  const { data: resetComplete, error: resetError } = await supabase.rpc(
    'consume_password_reset_and_revoke_sessions',
    {
      p_user_id: user.id,
      p_handoff_token_hash: hashHandoffToken(handoffToken),
      p_password_hash: passwordHash,
    },
  )

  if (resetError) {
    console.error('Error resetting password and revoking sessions:', resetError)
    throw new ApiError(500, 'Failed to reset password')
  }
  if (resetComplete !== true) {
    throw new ApiError(401, 'Password reset session expired. Please request a new code.')
  }

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

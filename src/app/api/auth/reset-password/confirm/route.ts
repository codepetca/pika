import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { hashPassword } from '@/lib/crypto'
import { createSession } from '@/lib/auth'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { resetPasswordConfirmSchema } from '@/lib/validations/auth'

export const POST = withErrorHandler('ResetPasswordConfirm', async (request: NextRequest) => {
  const { email: normalizedEmail, password } = resetPasswordConfirmSchema.parse(await request.json())

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

  // Verify that user has a recent used reset code
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)

  const { data: recentCode } = await supabase
    .from('verification_codes')
    .select('id, used_at')
    .eq('user_id', user.id)
    .eq('purpose', 'reset_password')
    .not('used_at', 'is', null)
    .gte('used_at', fiveMinutesAgo.toISOString())
    .order('used_at', { ascending: false })
    .limit(1)
    .single()

  if (!recentCode) {
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

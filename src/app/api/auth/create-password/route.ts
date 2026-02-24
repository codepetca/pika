import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { hashPassword } from '@/lib/crypto'
import { createSession } from '@/lib/auth'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { createPasswordSchema } from '@/lib/validations/auth'

export const POST = withErrorHandler('CreatePassword', async (request: NextRequest) => {
  const { email: normalizedEmail, password } = createPasswordSchema.parse(await request.json())

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

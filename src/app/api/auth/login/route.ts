import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { verifyPassword } from '@/lib/crypto'
import { createSession } from '@/lib/auth'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { loginSchema } from '@/lib/validations/auth'

export const POST = withErrorHandler('Login', async (request: NextRequest) => {
  const { email: normalizedEmail, password } = loginSchema.parse(await request.json())

  const supabase = getServiceRoleClient()

  // Find user by email
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, email, role, password_hash')
    .eq('email', normalizedEmail)
    .single()

  if (userError || !user) {
    throw new ApiError(401, 'Invalid email or password')
  }

  // Check if user has a password set
  if (!user.password_hash) {
    throw new ApiError(400, 'Please complete signup by setting a password')
  }

  // Verify password
  const isValidPassword = await verifyPassword(password, user.password_hash)

  if (!isValidPassword) {
    throw new ApiError(401, 'Invalid email or password')
  }

  // Create session
  await createSession(user.id, user.email, user.role)

  const redirectUrl = '/classrooms'

  return NextResponse.json({
    success: true,
    message: 'Login successful',
    redirectUrl,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  })
})

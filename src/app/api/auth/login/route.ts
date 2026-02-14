import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { verifyPassword } from '@/lib/crypto'
import { createSession } from '@/lib/auth'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { loginSchema } from '@/lib/validations/auth'
import { clearExpiredLockout, getLockoutMinutesLeft, incrementLoginAttempts, loginAttempts } from '@/lib/login-lockout'
import { processLoginStreakForAllClassrooms } from '@/lib/server/world-engine'

export const POST = withErrorHandler('Login', async (request: NextRequest) => {
  const { email: normalizedEmail, password } = loginSchema.parse(await request.json())

  clearExpiredLockout(normalizedEmail)

  const minutesLeft = getLockoutMinutesLeft(normalizedEmail)
  if (minutesLeft !== null) {
    throw new ApiError(
      429,
      `Too many failed attempts. Try again in ${minutesLeft} minute${minutesLeft > 1 ? 's' : ''}.`
    )
  }

  const supabase = getServiceRoleClient()

  // Find user by email
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, email, role, password_hash')
    .eq('email', normalizedEmail)
    .single()

  if (userError || !user) {
    incrementLoginAttempts(normalizedEmail)
    throw new ApiError(401, 'Invalid email or password')
  }

  // Check if user has a password set
  if (!user.password_hash) {
    throw new ApiError(400, 'Please complete signup by setting a password')
  }

  // Verify password
  const isValidPassword = await verifyPassword(password, user.password_hash)

  if (!isValidPassword) {
    incrementLoginAttempts(normalizedEmail)
    throw new ApiError(401, 'Invalid email or password')
  }

  loginAttempts.delete(normalizedEmail)

  // Create session
  await createSession(user.id, user.email, user.role)

  if (user.role === 'student') {
    processLoginStreakForAllClassrooms(user.id).catch((error) => {
      console.error('World login streak update error:', error)
    })
  }

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

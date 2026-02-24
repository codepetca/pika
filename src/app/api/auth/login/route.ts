import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { verifyPassword } from '@/lib/crypto'
import { createSession } from '@/lib/auth'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { clearExpiredLockout, getLockoutMinutesLeft, incrementLoginAttempts, resetLoginAttempts } from '@/lib/login-lockout'

export const POST = withErrorHandler('Login', async (request: NextRequest) => {
  const body = await request.json()
  const { email, password } = body

  if (!email || !password) {
    throw new ApiError(400, 'Email and password are required')
  }

  const normalizedEmail = email.toLowerCase().trim()

  // Remove expired lockouts
  await clearExpiredLockout(normalizedEmail)

  // Check if account is locked
  const minutesLeft = await getLockoutMinutesLeft(normalizedEmail)
  if (minutesLeft !== null) {
    throw new ApiError(429, `Too many failed attempts. Try again in ${minutesLeft} minute${minutesLeft > 1 ? 's' : ''}.`)
  }

  const supabase = getServiceRoleClient()

  // Find user by email
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, email, role, password_hash')
    .eq('email', normalizedEmail)
    .single()

  if (userError || !user) {
    // Increment failed attempts
    await incrementLoginAttempts(normalizedEmail)
    throw new ApiError(401, 'Invalid email or password')
  }

  // Check if user has a password set
  if (!user.password_hash) {
    throw new ApiError(400, 'Please complete signup by setting a password')
  }

  // Verify password
  const isValidPassword = await verifyPassword(password, user.password_hash)

  if (!isValidPassword) {
    // Increment failed attempts
    await incrementLoginAttempts(normalizedEmail)
    throw new ApiError(401, 'Invalid email or password')
  }

  // Reset login attempts on successful login
  await resetLoginAttempts(normalizedEmail)

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

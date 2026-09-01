import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { verifyPassword } from '@/lib/crypto'
import { createSession } from '@/lib/auth'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { loginSchema } from '@/lib/validations/auth'
import {
  clearAuthRateLimit,
  consumeAuthRateLimit,
} from '@/lib/server/auth-rate-limit'

const LOGIN_MAX_ATTEMPTS = 10
const LOGIN_WINDOW_SECONDS = 15 * 60
// A public fixed bcrypt hash makes missing-account and passwordless-account
// failures perform the same expensive comparison as a normal login failure.
const DUMMY_PASSWORD_HASH = '$2a$10$lpkNmMXcHq.HXd/ovw0RxehO6zovy.9SfT9kFmgSxAU9Ufk7G6f.K'

export const POST = withErrorHandler('Login', async (request: NextRequest) => {
  const { email: normalizedEmail, password } = loginSchema.parse(await request.json())

  const supabase = getServiceRoleClient()

  await consumeAuthRateLimit({
    scope: 'login',
    value: normalizedEmail,
    maxAttempts: LOGIN_MAX_ATTEMPTS,
    windowSeconds: LOGIN_WINDOW_SECONDS,
    supabase,
  })

  // Find user by email
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, email, role, password_hash')
    .eq('email', normalizedEmail)
    .single()

  const isValidPassword = await verifyPassword(
    password,
    user?.password_hash || DUMMY_PASSWORD_HASH,
  )

  if (userError || !user || !user.password_hash || !isValidPassword) {
    throw new ApiError(401, 'Invalid email or password')
  }

  await clearAuthRateLimit({ scope: 'login', value: normalizedEmail, supabase })

  // Create session only after the shared limiter has been reset successfully.
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

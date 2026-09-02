import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { verifyPassword } from '@/lib/crypto'
import { createSession } from '@/lib/auth'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { loginSchema } from '@/lib/validations/auth'
import {
  clearAuthRateLimit,
  consumeAuthRequestRateLimits,
} from '@/lib/server/auth-rate-limit'
import { DUMMY_AUTH_BCRYPT_HASH } from '@/lib/server/auth-response'

const LOGIN_MAX_ATTEMPTS = 10
const LOGIN_WINDOW_SECONDS = 15 * 60
// A public fixed bcrypt hash makes missing-account and passwordless-account
// failures perform the same expensive comparison as a normal login failure.

export const POST = withErrorHandler('Login', async (request: NextRequest) => {
  const { email: normalizedEmail, password } = loginSchema.parse(await request.json())

  const supabase = getServiceRoleClient()

  await consumeAuthRequestRateLimits({
    action: 'login',
    request,
    identifier: normalizedEmail,
    identifierMaxAttempts: LOGIN_MAX_ATTEMPTS,
    clientMaxAttempts: 60,
    windowSeconds: LOGIN_WINDOW_SECONDS,
    supabase,
  })

  // Find user by email
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, email, role, password_hash, auth_credential_version')
    .eq('email', normalizedEmail)
    .single()

  const isValidPassword = await verifyPassword(
    password,
    user?.password_hash || DUMMY_AUTH_BCRYPT_HASH,
  )

  if (userError || !user || !user.password_hash || !isValidPassword) {
    throw new ApiError(401, 'Invalid email or password')
  }

  await clearAuthRateLimit({ scope: 'login_identifier', value: normalizedEmail, supabase })

  // Create session only after the shared limiter has been reset successfully.
  await createSession(user.id, user.email, user.role, {
    expectedCredentialVersion: user.auth_credential_version,
  })

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

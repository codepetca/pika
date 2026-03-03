import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { generateVerificationCode, hashCode } from '@/lib/crypto'
import { sendSignupCode } from '@/lib/email'
import { isTeacherEmail } from '@/lib/auth'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { signupSchema } from '@/lib/validations/auth'

const MAX_CODES_PER_HOUR = 5
const CODE_EXPIRY_MINUTES = 10

export const POST = withErrorHandler('Signup', async (request: NextRequest) => {
  const { email: normalizedEmail } = signupSchema.parse(await request.json())

  const supabase = getServiceRoleClient()

  // Check if user already exists with a password
  const { data: existingUser } = await supabase
    .from('users')
    .select('id, email, password_hash, email_verified_at')
    .eq('email', normalizedEmail)
    .single()

  if (existingUser && existingUser.password_hash) {
    throw new ApiError(400, 'An account with this email already exists. Please login instead.')
  }

  // Create user if doesn't exist (or update existing user without password)
  let userId: string

  if (existingUser) {
    userId = existingUser.id
  } else {
    // Determine role
    const role = isTeacherEmail(normalizedEmail) ? 'teacher' : 'student'

    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({
        email: normalizedEmail,
        role,
      })
      .select('id')
      .single()

    if (createError) {
      console.error('Error creating user:', createError)
      throw new ApiError(500, 'Failed to create user')
    }

    userId = newUser!.id
  }

  // Rate limiting: check how many codes were requested in the last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)

  const { data: recentCodes, error: checkError } = await supabase
    .from('verification_codes')
    .select('id')
    .eq('user_id', userId)
    .eq('purpose', 'signup')
    .gte('created_at', oneHourAgo.toISOString())

  if (checkError) {
    console.error('Error checking recent codes:', checkError)
    throw new ApiError(500, 'Internal server error')
  }

  if (recentCodes && recentCodes.length >= MAX_CODES_PER_HOUR) {
    throw new ApiError(429, 'Too many code requests. Please try again later.')
  }

  // Generate and hash code
  const code = generateVerificationCode()
  const codeHash = await hashCode(code)

  // Calculate expiry
  const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000)

  // Store hashed code
  const { error: insertError } = await supabase
    .from('verification_codes')
    .insert({
      user_id: userId,
      code_hash: codeHash,
      purpose: 'signup',
      expires_at: expiresAt.toISOString(),
      attempts: 0,
    })

  if (insertError) {
    console.error('Error inserting verification code:', insertError)
    throw new ApiError(500, 'Failed to generate code')
  }

  // Send code via email
  try {
    await sendSignupCode(normalizedEmail, code)
  } catch (emailError) {
    console.error('Error sending email:', emailError)
    // Don't fail the request if email fails, code is still in DB
  }

  return NextResponse.json({
    success: true,
    message: 'Verification code sent to your email',
  })
})

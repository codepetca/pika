import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { generateVerificationCode, hashCode } from '@/lib/crypto'
import { sendPasswordResetCode } from '@/lib/email'
import { withErrorHandler } from '@/lib/api-handler'
import { forgotPasswordSchema } from '@/lib/validations/auth'

const MAX_CODES_PER_HOUR = 3
const CODE_EXPIRY_MINUTES = 10

// Always returns success to prevent email enumeration
const SUCCESS_RESPONSE = {
  success: true,
  message: 'If this email exists and has an account, password reset instructions have been sent.',
}

export const POST = withErrorHandler('ForgotPassword', async (request: NextRequest) => {
  const { email: normalizedEmail } = forgotPasswordSchema.parse(await request.json())

  const supabase = getServiceRoleClient()

  // Find user by email
  const { data: user } = await supabase
    .from('users')
    .select('id, email, password_hash')
    .eq('email', normalizedEmail)
    .single()

  // Always return success to prevent email enumeration
  // But only send email if user exists and has a password
  if (!user || !user.password_hash) {
    return NextResponse.json(SUCCESS_RESPONSE)
  }

  // Rate limiting: check how many codes were requested in the last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)

  const { data: recentCodes, error: checkError } = await supabase
    .from('verification_codes')
    .select('id')
    .eq('user_id', user.id)
    .eq('purpose', 'reset_password')
    .gte('created_at', oneHourAgo.toISOString())

  if (checkError) {
    console.error('Error checking recent codes:', checkError)
    return NextResponse.json(SUCCESS_RESPONSE)
  }

  if (recentCodes && recentCodes.length >= MAX_CODES_PER_HOUR) {
    return NextResponse.json(SUCCESS_RESPONSE)
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
      user_id: user.id,
      code_hash: codeHash,
      purpose: 'reset_password',
      expires_at: expiresAt.toISOString(),
      attempts: 0,
    })

  if (insertError) {
    console.error('Error inserting verification code:', insertError)
    return NextResponse.json(SUCCESS_RESPONSE)
  }

  // Send code via email
  try {
    await sendPasswordResetCode(normalizedEmail, code)
  } catch (emailError) {
    console.error('Error sending email:', emailError)
  }

  return NextResponse.json(SUCCESS_RESPONSE)
})

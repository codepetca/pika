import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { generateVerificationCode, hashCode } from '@/lib/crypto'
import { sendPasswordResetCode } from '@/lib/email'

const MAX_CODES_PER_HOUR = 3
const CODE_EXPIRY_MINUTES = 10

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email } = body

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      )
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(normalizedEmail)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      )
    }

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
      return NextResponse.json({
        success: true,
        message: 'If this email exists and has an account, password reset instructions have been sent.',
      })
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
      // Still return success to prevent enumeration
      return NextResponse.json({
        success: true,
        message: 'If this email exists and has an account, password reset instructions have been sent.',
      })
    }

    if (recentCodes && recentCodes.length >= MAX_CODES_PER_HOUR) {
      // Rate limited, but still return success
      return NextResponse.json({
        success: true,
        message: 'If this email exists and has an account, password reset instructions have been sent.',
      })
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
      // Still return success to prevent enumeration
      return NextResponse.json({
        success: true,
        message: 'If this email exists and has an account, password reset instructions have been sent.',
      })
    }

    // Send code via email
    try {
      await sendPasswordResetCode(normalizedEmail, code)
    } catch (emailError) {
      console.error('Error sending email:', emailError)
      // Don't fail the request if email fails
    }

    return NextResponse.json({
      success: true,
      message: 'If this email exists and has an account, password reset instructions have been sent.',
    })
  } catch (error) {
    console.error('Forgot password error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

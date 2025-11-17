import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { generateVerificationCode, hashCode } from '@/lib/crypto'
import { sendSignupCode } from '@/lib/email'
import { isTeacherEmail } from '@/lib/auth'

const MAX_CODES_PER_HOUR = 5
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

    // Check if user already exists with a password
    const { data: existingUser } = await supabase
      .from('users')
      .select('id, email, password_hash, email_verified_at')
      .eq('email', normalizedEmail)
      .single()

    if (existingUser && existingUser.password_hash) {
      return NextResponse.json(
        { error: 'An account with this email already exists. Please login instead.' },
        { status: 400 }
      )
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
        return NextResponse.json(
          { error: 'Failed to create user' },
          { status: 500 }
        )
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
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      )
    }

    if (recentCodes && recentCodes.length >= MAX_CODES_PER_HOUR) {
      return NextResponse.json(
        { error: 'Too many code requests. Please try again later.' },
        { status: 429 }
      )
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
      return NextResponse.json(
        { error: 'Failed to generate code' },
        { status: 500 }
      )
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
  } catch (error) {
    console.error('Signup error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

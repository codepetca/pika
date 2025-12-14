import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { hashPassword, validatePassword } from '@/lib/crypto'
import { createSession } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password, passwordConfirmation } = body

    if (!email || !password || !passwordConfirmation) {
      return NextResponse.json(
        { error: 'Email, password, and password confirmation are required' },
        { status: 400 }
      )
    }

    // Validate passwords match
    if (password !== passwordConfirmation) {
      return NextResponse.json(
        { error: 'Passwords do not match' },
        { status: 400 }
      )
    }

    // Validate password strength
    const passwordError = validatePassword(password)
    if (passwordError) {
      return NextResponse.json(
        { error: passwordError },
        { status: 400 }
      )
    }

    const normalizedEmail = email.toLowerCase().trim()
    const supabase = getServiceRoleClient()

    // Find user by email
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email, role, email_verified_at, password_hash')
      .eq('email', normalizedEmail)
      .single()

    if (userError || !user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Check if user already has a password
    if (user.password_hash) {
      return NextResponse.json(
        { error: 'This account already has a password' },
        { status: 400 }
      )
    }

    // Check if email is verified
    if (!user.email_verified_at) {
      return NextResponse.json(
        { error: 'Email must be verified before creating a password' },
        { status: 400 }
      )
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
      return NextResponse.json(
        { error: 'Failed to create password' },
        { status: 500 }
      )
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
  } catch (error) {
    console.error('Create password error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

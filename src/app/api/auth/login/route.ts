import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { verifyPassword } from '@/lib/crypto'
import { createSession } from '@/lib/auth'
import { clearExpiredLockout, getLockoutMinutesLeft, incrementLoginAttempts, loginAttempts } from '@/lib/login-lockout'
import { processLoginStreakForAllClassrooms } from '@/lib/server/world-engine'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Remove expired lockouts
    clearExpiredLockout(normalizedEmail)

    // Check if account is locked
    const minutesLeft = getLockoutMinutesLeft(normalizedEmail)
    if (minutesLeft !== null) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${minutesLeft} minute${minutesLeft > 1 ? 's' : ''}.` },
        { status: 429 }
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
      // Increment failed attempts
      incrementLoginAttempts(normalizedEmail)
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // Check if user has a password set
    if (!user.password_hash) {
      return NextResponse.json(
        { error: 'Please complete signup by setting a password' },
        { status: 400 }
      )
    }

    // Verify password
    const isValidPassword = await verifyPassword(password, user.password_hash)

    if (!isValidPassword) {
      // Increment failed attempts
      incrementLoginAttempts(normalizedEmail)
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // Reset login attempts on successful login
    loginAttempts.delete(normalizedEmail)

    // Create session
    await createSession(user.id, user.email, user.role)

    // Fire-and-forget world login streak update (per classroom world)
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
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

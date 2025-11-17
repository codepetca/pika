import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { verifyPassword } from '@/lib/crypto'
import { createSession } from '@/lib/auth'

const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 15 * 60 * 1000 // 15 minutes

// In-memory store for login attempts (in production, use Redis or DB)
const loginAttempts = new Map<string, { count: number; lockedUntil: number | null }>()

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

    // Check if account is locked
    const attempts = loginAttempts.get(normalizedEmail)
    if (attempts?.lockedUntil && Date.now() < attempts.lockedUntil) {
      const minutesLeft = Math.ceil((attempts.lockedUntil - Date.now()) / 60000)
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

    // Return redirect URL based on role
    const redirectUrl = user.role === 'teacher'
      ? '/teacher/dashboard'
      : '/student/today'

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

function incrementLoginAttempts(email: string) {
  const attempts = loginAttempts.get(email) || { count: 0, lockedUntil: null }
  attempts.count++

  if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
    attempts.lockedUntil = Date.now() + LOCKOUT_DURATION_MS
  }

  loginAttempts.set(email, attempts)

  // Clean up old entries after 1 hour
  setTimeout(() => {
    const current = loginAttempts.get(email)
    if (current && current.lockedUntil && Date.now() > current.lockedUntil) {
      loginAttempts.delete(email)
    }
  }, 60 * 60 * 1000)
}

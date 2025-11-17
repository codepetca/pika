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
      .select('id, email, role')
      .eq('email', normalizedEmail)
      .single()

    if (userError || !user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Verify that user has a recent used reset code
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)

    const { data: recentCode } = await supabase
      .from('verification_codes')
      .select('id, used_at')
      .eq('user_id', user.id)
      .eq('purpose', 'reset_password')
      .not('used_at', 'is', null)
      .gte('used_at', fiveMinutesAgo.toISOString())
      .order('used_at', { ascending: false })
      .limit(1)
      .single()

    if (!recentCode) {
      return NextResponse.json(
        { error: 'Password reset session expired. Please request a new code.' },
        { status: 401 }
      )
    }

    // Hash password
    const passwordHash = await hashPassword(password)

    // Update password
    const { error: updateError } = await supabase
      .from('users')
      .update({ password_hash: passwordHash })
      .eq('id', user.id)

    if (updateError) {
      console.error('Error updating password:', updateError)
      return NextResponse.json(
        { error: 'Failed to reset password' },
        { status: 500 }
      )
    }

    // Optionally: Invalidate all existing sessions for this user
    // This would require implementing session tracking in the database

    // Create new session
    await createSession(user.id, user.email, user.role)

    // Return redirect URL based on role
    const redirectUrl = user.role === 'teacher'
      ? '/teacher/dashboard'
      : '/student/today'

    return NextResponse.json({
      success: true,
      message: 'Password reset successfully',
      redirectUrl,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    })
  } catch (error) {
    console.error('Reset password confirm error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

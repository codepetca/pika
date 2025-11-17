import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { verifyCode } from '@/lib/crypto'
import { createSession, isTeacherEmail } from '@/lib/auth'

const MAX_VERIFICATION_ATTEMPTS = 3

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, code } = body

    if (!email || !code) {
      return NextResponse.json(
        { error: 'Email and code are required' },
        { status: 400 }
      )
    }

    const normalizedEmail = email.toLowerCase().trim()
    const normalizedCode = code.toUpperCase().trim()

    const supabase = getServiceRoleClient()

    // Find unused, non-expired codes for this email
    const { data: codes, error: fetchError } = await supabase
      .from('login_codes')
      .select('*')
      .eq('email', normalizedEmail)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })

    if (fetchError) {
      console.error('Error fetching login codes:', fetchError)
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      )
    }

    if (!codes || codes.length === 0) {
      return NextResponse.json(
        { error: 'Invalid or expired code' },
        { status: 401 }
      )
    }

    // Try to verify against each code (most recent first)
    let validCode = null

    for (const codeRecord of codes) {
      // Check if too many attempts
      if (codeRecord.attempts >= MAX_VERIFICATION_ATTEMPTS) {
        continue
      }

      // Verify code hash
      const isValid = await verifyCode(normalizedCode, codeRecord.code_hash)

      if (isValid) {
        validCode = codeRecord
        break
      } else {
        // Increment attempts
        await supabase
          .from('login_codes')
          .update({ attempts: codeRecord.attempts + 1 })
          .eq('id', codeRecord.id)
      }
    }

    if (!validCode) {
      return NextResponse.json(
        { error: 'Invalid code' },
        { status: 401 }
      )
    }

    // Mark code as used
    await supabase
      .from('login_codes')
      .update({ used: true })
      .eq('id', validCode.id)

    // Determine role
    const role = isTeacherEmail(normalizedEmail) ? 'teacher' : 'student'

    // Create or get user
    let { data: user, error: userFetchError } = await supabase
      .from('users')
      .select('*')
      .eq('email', normalizedEmail)
      .single()

    if (userFetchError && userFetchError.code !== 'PGRST116') {
      console.error('Error fetching user:', userFetchError)
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      )
    }

    if (!user) {
      // Create new user
      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert({
          email: normalizedEmail,
          role,
        })
        .select()
        .single()

      if (createError) {
        console.error('Error creating user:', createError)
        return NextResponse.json(
          { error: 'Failed to create user' },
          { status: 500 }
        )
      }

      user = newUser
    }

    // Create session
    await createSession(user.id, user.email, user.role)

    // Return redirect URL based on role
    const redirectUrl = user.role === 'teacher'
      ? '/teacher/dashboard'
      : '/student/today'

    return NextResponse.json({
      success: true,
      redirectUrl,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    })
  } catch (error) {
    console.error('Verify code error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

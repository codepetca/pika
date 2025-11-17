import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { verifyCode } from '@/lib/crypto'

const MAX_VERIFICATION_ATTEMPTS = 5

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

    // Find user by email
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email, password_hash')
      .eq('email', normalizedEmail)
      .single()

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Invalid email or code' },
        { status: 401 }
      )
    }

    // Check if user already has a password
    if (user.password_hash) {
      return NextResponse.json(
        { error: 'This account already has a password. Please login instead.' },
        { status: 400 }
      )
    }

    // Find unused, non-expired verification codes for this user
    const { data: codes, error: fetchError } = await supabase
      .from('verification_codes')
      .select('*')
      .eq('user_id', user.id)
      .eq('purpose', 'signup')
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })

    if (fetchError) {
      console.error('Error fetching verification codes:', fetchError)
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
          .from('verification_codes')
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

    // Mark code as used and verify email
    await supabase
      .from('verification_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('id', validCode.id)

    await supabase
      .from('users')
      .update({ email_verified_at: new Date().toISOString() })
      .eq('id', user.id)

    return NextResponse.json({
      success: true,
      message: 'Email verified successfully',
      userId: user.id,
    })
  } catch (error) {
    console.error('Verify signup error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

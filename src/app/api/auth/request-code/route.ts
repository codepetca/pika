import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { generateCode, hashCode } from '@/lib/crypto'
import { sendLoginCode } from '@/lib/email'

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

    // Rate limiting: check how many codes were requested in the last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)

    const { data: recentCodes, error: checkError } = await supabase
      .from('login_codes')
      .select('id')
      .eq('email', normalizedEmail)
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
    const code = generateCode()
    const codeHash = await hashCode(code)

    // Calculate expiry
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000)

    // Store hashed code
    const { error: insertError } = await supabase
      .from('login_codes')
      .insert({
        email: normalizedEmail,
        code_hash: codeHash,
        expires_at: expiresAt.toISOString(),
        used: false,
        attempts: 0,
      })

    if (insertError) {
      console.error('Error inserting login code:', insertError)
      return NextResponse.json(
        { error: 'Failed to generate code' },
        { status: 500 }
      )
    }

    // Send code via email (console log in dev)
    try {
      await sendLoginCode(normalizedEmail, code)
    } catch (emailError) {
      console.error('Error sending email:', emailError)
      // Don't fail the request if email fails, code is still in DB
    }

    return NextResponse.json({
      success: true,
      message: 'Login code sent to your email',
    })
  } catch (error) {
    console.error('Request code error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

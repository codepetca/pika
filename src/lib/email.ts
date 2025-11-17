/**
 * Sends an email with a login code (legacy - for backward compatibility)
 * In development mode (ENABLE_MOCK_EMAIL=true), logs to console instead
 */
export async function sendLoginCode(email: string, code: string): Promise<void> {
  const isMockMode = process.env.ENABLE_MOCK_EMAIL === 'true'

  if (isMockMode) {
    console.log('\n' + '='.repeat(60))
    console.log('📧 LOGIN CODE EMAIL (LEGACY)')
    console.log('='.repeat(60))
    console.log(`To: ${email}`)
    console.log(`Code: ${code}`)
    console.log('='.repeat(60) + '\n')
    return
  }

  // In production, implement actual email sending here
  // For example, using Resend, SendGrid, or Nodemailer
  throw new Error('Production email sending not implemented')
}

/**
 * Sends an email with a signup verification code
 * In development mode (ENABLE_MOCK_EMAIL=true), logs to console instead
 */
export async function sendSignupCode(email: string, code: string): Promise<void> {
  const isMockMode = process.env.ENABLE_MOCK_EMAIL === 'true'

  if (isMockMode) {
    console.log('\n' + '='.repeat(60))
    console.log('📧 SIGNUP VERIFICATION CODE')
    console.log('='.repeat(60))
    console.log(`To: ${email}`)
    console.log(`Subject: Verify your email for Pika`)
    console.log('')
    console.log(`Your verification code is: ${code}`)
    console.log('')
    console.log('This code will expire in 10 minutes.')
    console.log('Enter this code to verify your email and create your password.')
    console.log('='.repeat(60) + '\n')
    return
  }

  // In production, implement actual email sending here
  // For example, using Resend, SendGrid, or Nodemailer
  throw new Error('Production email sending not implemented')
}

/**
 * Sends an email with a password reset verification code
 * In development mode (ENABLE_MOCK_EMAIL=true), logs to console instead
 */
export async function sendPasswordResetCode(email: string, code: string): Promise<void> {
  const isMockMode = process.env.ENABLE_MOCK_EMAIL === 'true'

  if (isMockMode) {
    console.log('\n' + '='.repeat(60))
    console.log('📧 PASSWORD RESET CODE')
    console.log('='.repeat(60))
    console.log(`To: ${email}`)
    console.log(`Subject: Reset your Pika password`)
    console.log('')
    console.log(`Your password reset code is: ${code}`)
    console.log('')
    console.log('This code will expire in 10 minutes.')
    console.log('Enter this code to reset your password.')
    console.log('')
    console.log('If you did not request a password reset, please ignore this email.')
    console.log('='.repeat(60) + '\n')
    return
  }

  // In production, implement actual email sending here
  // For example, using Resend, SendGrid, or Nodemailer
  throw new Error('Production email sending not implemented')
}

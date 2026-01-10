import { sendBrevoEmail } from './brevo'

/**
 * Sends an email with a signup verification code
 * In development mode (ENABLE_MOCK_EMAIL=true), logs to console instead
 * In production/staging, sends via Brevo template
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

  // Send via Brevo template
  await sendBrevoEmail({
    to: email,
    templateParams: {
      code,
      expires: 10,
      type: 'signup',
    },
  })
}

/**
 * Sends an email with a password reset verification code
 * In development mode (ENABLE_MOCK_EMAIL=true), logs to console instead
 * In production/staging, sends via Brevo template
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

  // Send via Brevo template
  await sendBrevoEmail({
    to: email,
    templateParams: {
      code,
      expires: 10,
      type: 'password_reset',
    },
  })
}

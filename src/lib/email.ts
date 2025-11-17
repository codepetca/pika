/**
 * Sends an email with a login code
 * In development mode (ENABLE_MOCK_EMAIL=true), logs to console instead
 */
export async function sendLoginCode(email: string, code: string): Promise<void> {
  const isMockMode = process.env.ENABLE_MOCK_EMAIL === 'true'

  if (isMockMode) {
    console.log('\n' + '='.repeat(60))
    console.log('📧 LOGIN CODE EMAIL')
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

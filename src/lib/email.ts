import * as brevo from '@getbrevo/brevo'

/**
 * Sends an email with a signup verification code
 * In development mode (ENABLE_MOCK_EMAIL=true), logs to console instead
 * In production, sends via Brevo (requires BREVO_API_KEY)
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

  // Send via Brevo
  await sendEmailViaBrevo({
    to: email,
    subject: 'Verify your email for Pika',
    htmlContent: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Email Verification</h1>
          </div>
          <div style="background: #f9fafb; padding: 40px 30px; border-radius: 0 0 10px 10px;">
            <p style="font-size: 16px; margin-bottom: 20px;">Thank you for signing up for Pika!</p>
            <p style="font-size: 16px; margin-bottom: 30px;">Your verification code is:</p>
            <div style="background: white; border: 2px solid #667eea; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #667eea; font-family: 'Courier New', monospace;">${code}</span>
            </div>
            <p style="font-size: 14px; color: #666; margin-top: 30px;">This code will expire in <strong>10 minutes</strong>.</p>
            <p style="font-size: 14px; color: #666;">Enter this code to verify your email and create your password.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
            <p style="font-size: 12px; color: #999; margin: 0;">If you didn't request this code, you can safely ignore this email.</p>
          </div>
        </body>
      </html>
    `,
  })
}

/**
 * Sends an email with a password reset verification code
 * In development mode (ENABLE_MOCK_EMAIL=true), logs to console instead
 * In production, sends via Brevo (requires BREVO_API_KEY)
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

  // Send via Brevo
  await sendEmailViaBrevo({
    to: email,
    subject: 'Reset your Pika password',
    htmlContent: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Password Reset</h1>
          </div>
          <div style="background: #f9fafb; padding: 40px 30px; border-radius: 0 0 10px 10px;">
            <p style="font-size: 16px; margin-bottom: 20px;">You requested to reset your password for Pika.</p>
            <p style="font-size: 16px; margin-bottom: 30px;">Your password reset code is:</p>
            <div style="background: white; border: 2px solid #667eea; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #667eea; font-family: 'Courier New', monospace;">${code}</span>
            </div>
            <p style="font-size: 14px; color: #666; margin-top: 30px;">This code will expire in <strong>10 minutes</strong>.</p>
            <p style="font-size: 14px; color: #666;">Enter this code to reset your password.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
            <p style="font-size: 12px; color: #999; margin: 0;"><strong>If you didn't request a password reset, please ignore this email.</strong> Your password will not be changed.</p>
          </div>
        </body>
      </html>
    `,
  })
}

/**
 * Internal helper to send emails via Brevo
 */
async function sendEmailViaBrevo({
  to,
  subject,
  htmlContent,
}: {
  to: string
  subject: string
  htmlContent: string
}): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY

  if (!apiKey) {
    throw new Error(
      'BREVO_API_KEY is not configured. Set ENABLE_MOCK_EMAIL=true for development or configure BREVO_API_KEY for production.'
    )
  }

  try {
    const apiInstance = new brevo.TransactionalEmailsApi()
    apiInstance.setApiKey(
      brevo.TransactionalEmailsApiApiKeys.apiKey,
      apiKey
    )

    const sendSmtpEmail = new brevo.SendSmtpEmail()
    sendSmtpEmail.to = [{ email: to }]
    sendSmtpEmail.sender = {
      email: process.env.BREVO_SENDER_EMAIL || 'noreply@pikajournal.com',
      name: process.env.BREVO_SENDER_NAME || 'Pika',
    }
    sendSmtpEmail.subject = subject
    sendSmtpEmail.htmlContent = htmlContent

    await apiInstance.sendTransacEmail(sendSmtpEmail)
  } catch (error) {
    console.error('Failed to send email via Brevo:', error)
    throw new Error('Failed to send email. Please try again later.')
  }
}

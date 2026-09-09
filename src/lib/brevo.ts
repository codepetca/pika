/**
 * Brevo (Sendinblue) Email Integration
 *
 * Sends transactional emails using Brevo templates.
 */

export interface SendEmailOptions {
  to: string
  templateParams: Record<string, any>
}

/**
 * Sends an email via Brevo using a template
 *
 * @throws Error if BREVO_API_KEY or BREVO_TEMPLATE_ID are not configured
 * @throws Error if Brevo API request fails
 */
export async function sendBrevoEmail(opts: SendEmailOptions): Promise<{ messageId?: string }> {
  const apiKey = process.env.BREVO_API_KEY
  const templateId = Number(process.env.BREVO_TEMPLATE_ID)
  const fromEmail = process.env.BREVO_FROM_EMAIL || 'noreply@notify.codepet.ca'
  const fromName = process.env.BREVO_FROM_NAME || 'Pika'

  // Validate configuration
  if (!apiKey) {
    throw new Error('BREVO_API_KEY is not configured')
  }

  if (!templateId || isNaN(templateId)) {
    throw new Error('BREVO_TEMPLATE_ID is not configured or invalid')
  }

  // Send email via Brevo API
  let response: Response
  try {
    response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        sender: {
          email: fromEmail,
          name: fromName,
        },
        to: [{ email: opts.to }],
        templateId,
        params: opts.templateParams,
      }),
    })
  } catch {
    // Transport errors can contain recipient/template data; do not retain a raw cause.
    throw new Error('Failed to send email via Brevo (network error)')
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`Failed to send email via Brevo (${response.status})`)
  }

  let responseText: string
  try {
    responseText = await response.text()
  } catch {
    throw new Error(`Failed to read Brevo response (${response.status})`)
  }

  // Parse response to get messageId
  try {
    const data = JSON.parse(responseText)
    return { messageId: data.messageId }
  } catch {
    return { messageId: undefined }
  }
}

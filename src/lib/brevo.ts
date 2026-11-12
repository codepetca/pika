/**
 * Brevo (Sendinblue) Email Integration
 *
 * Sends transactional emails using Brevo templates.
 */

export type SendEmailOptions = {
  to: string
  signal?: AbortSignal
  tags?: string[]
  // Cloudflare Workers supports manual redirects and rejects redirect: error.
  manualRedirect?: true
  idempotencyKey?: string
} & ({ templateParams: Record<string, any> } | { subject: string; textContent: string })

/**
 * Sends a transactional template or a plain-text email via Brevo
 *
 * @throws Error if the required Brevo configuration is missing
 * @throws Error if Brevo API request fails
 */
export async function sendBrevoEmail(opts: SendEmailOptions): Promise<{ messageId?: string }> {
  const apiKey = process.env.BREVO_API_KEY
  const fromEmail = process.env.BREVO_FROM_EMAIL || 'noreply@notify.codepet.ca'
  const fromName = process.env.BREVO_FROM_NAME || 'Pika'

  // Validate configuration
  if (!apiKey) {
    throw new Error('BREVO_API_KEY is not configured')
  }

  let content: { templateId: number; params: Record<string, any> } | { subject: string; textContent: string }
  if ('templateParams' in opts) {
    const templateId = Number(process.env.BREVO_TEMPLATE_ID)
    if (!templateId || isNaN(templateId)) throw new Error('BREVO_TEMPLATE_ID is not configured or invalid')
    content = { templateId, params: opts.templateParams }
  } else {
    content = { subject: opts.subject, textContent: opts.textContent }
  }

  // Send email via Brevo API
  let response: Response
  try {
    response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      redirect: opts.manualRedirect ? 'manual' : 'error',
      ...(opts.signal && { signal: opts.signal }),
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
        ...(opts.idempotencyKey
          ? { messageVersions: [{ to: [{ email: opts.to }] }], headers: { idempotencyKey: opts.idempotencyKey } }
          : { to: [{ email: opts.to }] }),
        ...content,
        ...(opts.tags && { tags: opts.tags }),
      }),
    })
  } catch {
    // Transport errors can contain recipient/template data; do not retain a raw cause.
    throw new Error('Failed to send email via Brevo (network error)')
  }

  if (!response.ok) {
    if (opts.idempotencyKey && response.status === 400) {
      const failure = await response.json().catch(() => undefined)
      // Brevo uses this response when it has already accepted this batch key.
      if (failure?.code === 'duplicate_parameter') return {}
    }
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

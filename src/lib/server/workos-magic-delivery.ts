import { ApiError } from '@/lib/api-error'
import { sendBrevoEmail } from '@/lib/brevo'

export type WorkOSMagicAuthEmailDelivery = 'workos' | 'brevo'

const AUTH_UNAVAILABLE = 'Authentication is temporarily unavailable'

export function getWorkOSMagicAuthEmailDelivery(): WorkOSMagicAuthEmailDelivery {
  const delivery = (process.env.WORKOS_MAGIC_AUTH_EMAIL_DELIVERY ?? 'workos')
    .trim()
    .toLowerCase()

  if (delivery === 'workos') return 'workos'

  if (
    delivery === 'brevo'
    && process.env.WORKOS_MAGIC_AUTH_DEFAULT_EMAILS_DISABLED === 'true'
  ) {
    return 'brevo'
  }

  throw new ApiError(503, AUTH_UNAVAILABLE)
}

export async function deliverWorkOSMagicAuthCode(input: {
  email: string
  code: string
  delivery?: WorkOSMagicAuthEmailDelivery
}): Promise<void> {
  const delivery = input.delivery ?? getWorkOSMagicAuthEmailDelivery()
  if (delivery === 'workos') return

  if (!/^\d{6}$/.test(input.code)) {
    throw new ApiError(503, AUTH_UNAVAILABLE)
  }

  try {
    await sendBrevoEmail({
      to: input.email,
      templateParams: {
        code: input.code,
        expires: 10,
        type: 'magic_auth',
      },
    })
  } catch {
    throw new ApiError(503, AUTH_UNAVAILABLE)
  }
}

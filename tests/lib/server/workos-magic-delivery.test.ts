import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { sendBrevoEmail } = vi.hoisted(() => ({
  sendBrevoEmail: vi.fn(),
}))

vi.mock('@/lib/brevo', () => ({ sendBrevoEmail }))

import {
  deliverWorkOSMagicAuthCode,
  getWorkOSMagicAuthEmailDelivery,
} from '@/lib/server/workos-magic-delivery'

describe('WorkOS Magic Auth email delivery boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('WORKOS_MAGIC_AUTH_EMAIL_DELIVERY', 'workos')
    vi.stubEnv('WORKOS_MAGIC_AUTH_DEFAULT_EMAILS_DISABLED', 'false')
  })

  afterEach(() => vi.unstubAllEnvs())

  it('preserves WorkOS-managed email as the default and never calls Brevo', async () => {
    expect(getWorkOSMagicAuthEmailDelivery()).toBe('workos')

    await deliverWorkOSMagicAuthCode({
      email: 'student@example.com',
      code: '123456',
    })

    expect(sendBrevoEmail).not.toHaveBeenCalled()
  })

  it('fails closed when Brevo is selected without confirming WorkOS email is disabled', () => {
    vi.stubEnv('WORKOS_MAGIC_AUTH_EMAIL_DELIVERY', 'brevo')

    expect(() => getWorkOSMagicAuthEmailDelivery()).toThrowError(expect.objectContaining({
      statusCode: 503,
      message: 'Authentication is temporarily unavailable',
    }))
  })

  it('sends the WorkOS-generated code through the existing Brevo transport', async () => {
    vi.stubEnv('WORKOS_MAGIC_AUTH_EMAIL_DELIVERY', 'brevo')
    vi.stubEnv('WORKOS_MAGIC_AUTH_DEFAULT_EMAILS_DISABLED', 'true')
    sendBrevoEmail.mockResolvedValue({ messageId: 'brevo-message-1' })

    await deliverWorkOSMagicAuthCode({
      email: 'student@example.com',
      code: '123456',
    })

    expect(sendBrevoEmail).toHaveBeenCalledWith({
      to: 'student@example.com',
      templateParams: {
        code: '123456',
        expires: 10,
        type: 'magic_auth',
      },
    })
  })

  it('rejects malformed provider codes before email delivery', async () => {
    vi.stubEnv('WORKOS_MAGIC_AUTH_EMAIL_DELIVERY', 'brevo')
    vi.stubEnv('WORKOS_MAGIC_AUTH_DEFAULT_EMAILS_DISABLED', 'true')

    await expect(deliverWorkOSMagicAuthCode({
      email: 'student@example.com',
      code: 'not-a-code',
    })).rejects.toThrowError(expect.objectContaining({ statusCode: 503 }))
    expect(sendBrevoEmail).not.toHaveBeenCalled()
  })

  it('does not leak Brevo errors through the delivery boundary', async () => {
    vi.stubEnv('WORKOS_MAGIC_AUTH_EMAIL_DELIVERY', 'brevo')
    vi.stubEnv('WORKOS_MAGIC_AUTH_DEFAULT_EMAILS_DISABLED', 'true')
    sendBrevoEmail.mockRejectedValue(new Error('Brevo provider detail'))

    await expect(deliverWorkOSMagicAuthCode({
      email: 'student@example.com',
      code: '123456',
    })).rejects.toThrowError(expect.objectContaining({
      statusCode: 503,
      message: 'Authentication is temporarily unavailable',
    }))
  })

  it('rejects unknown delivery modes instead of silently sending duplicate email', () => {
    vi.stubEnv('WORKOS_MAGIC_AUTH_EMAIL_DELIVERY', 'smtp')

    expect(() => getWorkOSMagicAuthEmailDelivery()).toThrowError(expect.objectContaining({
      statusCode: 503,
    }))
  })
})

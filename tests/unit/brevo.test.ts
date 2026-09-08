/**
 * Unit tests for Brevo email integration (src/lib/brevo.ts)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendBrevoEmail } from '@/lib/brevo'

// Mock global fetch
const mockFetch = vi.fn()
global.fetch = mockFetch as any

describe('sendBrevoEmail', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('should throw error when BREVO_API_KEY is not configured', async () => {
    delete process.env.BREVO_API_KEY
    process.env.BREVO_TEMPLATE_ID = '2'

    await expect(
      sendBrevoEmail({
        to: 'test@example.com',
        templateParams: { code: 'ABC123' },
      })
    ).rejects.toThrow('BREVO_API_KEY is not configured')
  })

  it('should throw error when BREVO_TEMPLATE_ID is not configured', async () => {
    process.env.BREVO_API_KEY = 'test-key'
    delete process.env.BREVO_TEMPLATE_ID

    await expect(
      sendBrevoEmail({
        to: 'test@example.com',
        templateParams: { code: 'ABC123' },
      })
    ).rejects.toThrow('BREVO_TEMPLATE_ID is not configured or invalid')
  })

  it('should throw error when BREVO_TEMPLATE_ID is invalid', async () => {
    process.env.BREVO_API_KEY = 'test-key'
    process.env.BREVO_TEMPLATE_ID = 'not-a-number'

    await expect(
      sendBrevoEmail({
        to: 'test@example.com',
        templateParams: { code: 'ABC123' },
      })
    ).rejects.toThrow('BREVO_TEMPLATE_ID is not configured or invalid')
  })

  it('should send email with correct API call', async () => {
    process.env.BREVO_API_KEY = 'test-api-key'
    process.env.BREVO_TEMPLATE_ID = '2'
    process.env.BREVO_FROM_EMAIL = 'noreply@example.com'
    process.env.BREVO_FROM_NAME = 'Test App'

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ messageId: 'msg-123' }),
    })

    const result = await sendBrevoEmail({
      to: 'user@example.com',
      templateParams: {
        code: 'ABC123',
        expires: 10,
      },
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.brevo.com/v3/smtp/email',
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'api-key': 'test-api-key',
        },
        body: JSON.stringify({
          sender: {
            email: 'noreply@example.com',
            name: 'Test App',
          },
          to: [{ email: 'user@example.com' }],
          templateId: 2,
          params: {
            code: 'ABC123',
            expires: 10,
          },
        }),
      }
    )

    expect(result).toEqual({ messageId: 'msg-123' })
  })

  it('should use default sender when BREVO_FROM_EMAIL not set', async () => {
    process.env.BREVO_API_KEY = 'test-api-key'
    process.env.BREVO_TEMPLATE_ID = '2'
    delete process.env.BREVO_FROM_EMAIL
    delete process.env.BREVO_FROM_NAME

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ messageId: 'msg-123' }),
    })

    await sendBrevoEmail({
      to: 'user@example.com',
      templateParams: { code: 'ABC123' },
    })

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.sender).toEqual({
      email: 'noreply@notify.codepet.ca',
      name: 'Pika',
    })
  })

  it('should throw error when Brevo API fails', async () => {
    process.env.BREVO_API_KEY = 'test-api-key'
    process.env.BREVO_TEMPLATE_ID = '2'

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    })

    await expect(
      sendBrevoEmail({
        to: 'user@example.com',
        templateParams: { code: 'ABC123' },
      })
    ).rejects.toThrow(/^Failed to send email via Brevo \(401\)$/)
    expect(console.error).not.toHaveBeenCalled()
  })

  it.each(['http', 'network', 'body'])('does not retain private data from a %s failure', async (failure) => {
    process.env.BREVO_API_KEY = 'synthetic-key'
    process.env.BREVO_TEMPLATE_ID = '2'
    const privateMarker = 'PRIVATE student@example.invalid code-123456'
    const readBody = vi.fn().mockRejectedValue(new Error(privateMarker))
    const cancel = vi.fn().mockRejectedValue(new Error(privateMarker))
    if (failure === 'network') mockFetch.mockRejectedValueOnce(new Error(privateMarker))
    else mockFetch.mockResolvedValueOnce({ ok: failure !== 'http', status: failure === 'http' ? 400 : 201,
      text: readBody, body: { cancel } })
    const error = await sendBrevoEmail({ to: 'student@example.invalid', templateParams: { code: '123456' } })
      .catch((error: unknown) => error)
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).not.toContain(privateMarker)
    expect(error).not.toHaveProperty('cause')
    expect(console.error).not.toHaveBeenCalled()
    if (failure === 'http') {
      expect(readBody).not.toHaveBeenCalled()
      expect(cancel).toHaveBeenCalledOnce()
    }
  })

  it('should return messageId undefined when response is not JSON', async () => {
    process.env.BREVO_API_KEY = 'test-api-key'
    process.env.BREVO_TEMPLATE_ID = '2'

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => 'Not JSON',
    })

    const result = await sendBrevoEmail({
      to: 'user@example.com',
      templateParams: { code: 'ABC123' },
    })

    expect(result).toEqual({ messageId: undefined })
  })
})

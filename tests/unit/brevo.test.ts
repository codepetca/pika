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
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
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
    ).rejects.toThrow('Failed to send email via Brevo (401): Unauthorized')
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

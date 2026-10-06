import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestAuthCodeResend } from '@/lib/auth-code-resend'

afterEach(() => vi.unstubAllGlobals())

describe('auth code resend transport', () => {
  it.each([
    ['signup', '/api/auth/signup'],
    ['reset', '/api/auth/forgot-password'],
  ] as const)('preserves the %s endpoint and email-only payload', async (kind, endpoint) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    await requestAuthCodeResend(kind, 'student@example.com')
    expect(fetchMock).toHaveBeenCalledWith(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'student@example.com' }),
    })
  })

  it.each([429, 500])('rejects HTTP %s without reading an error body', async (status) => {
    const json = vi.fn().mockRejectedValue(new Error('not JSON'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, json }))
    await expect(requestAuthCodeResend('reset', 'student@example.com')).rejects.toThrow('Failed to resend code')
    expect(json).not.toHaveBeenCalled()
  })

  it('propagates a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    await expect(requestAuthCodeResend('signup', 'student@example.com')).rejects.toThrow('network')
  })
})

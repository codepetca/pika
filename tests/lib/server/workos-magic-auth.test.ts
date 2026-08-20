import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createMagicAuth: vi.fn(),
  authenticateWithMagicAuth: vi.fn(),
  deliverWorkOSMagicAuthCode: vi.fn(),
  getWorkOSMagicAuthEmailDelivery: vi.fn(() => 'brevo'),
}))

vi.mock('@workos-inc/authkit-nextjs', () => ({
  getWorkOS: () => ({
    userManagement: {
      createMagicAuth: mocks.createMagicAuth,
      authenticateWithMagicAuth: mocks.authenticateWithMagicAuth,
    },
  }),
}))

vi.mock('@/lib/server/workos-magic-delivery', () => ({
  getWorkOSMagicAuthEmailDelivery: mocks.getWorkOSMagicAuthEmailDelivery,
  deliverWorkOSMagicAuthCode: mocks.deliverWorkOSMagicAuthCode,
}))

import {
  mapWorkOSMagicAuthError,
  startWorkOSMagicAuth,
  verifyWorkOSMagicAuth,
} from '@/lib/server/workos-magic-auth'

describe('WorkOS Magic Auth provider boundary', () => {
  beforeEach(() => {
    vi.stubEnv('WORKOS_CLIENT_ID', 'client_pika_test')
    vi.stubEnv('WORKOS_API_KEY', 'sk_test_pika')
    vi.stubEnv('WORKOS_COOKIE_PASSWORD', 'test-cookie-password-with-32-characters')
    vi.clearAllMocks()
  })

  afterEach(() => vi.unstubAllEnvs())

  it('returns only non-secret challenge state and threads request risk context', async () => {
    mocks.createMagicAuth.mockResolvedValue({
      id: 'magic_auth_secret_id',
      code: '123456',
      expiresAt: '2026-08-16T18:00:00.000Z',
      radarAuthAttemptId: 'radar_attempt_1',
    })
    const request = new Request('https://pika.codepet.ca/api/auth/workos/magic/start', {
      headers: {
        'x-forwarded-for': '203.0.113.10, 10.0.0.1',
        'user-agent': 'Pika test browser',
      },
    })

    const result = await startWorkOSMagicAuth('student@example.com', request)

    expect(result).toEqual({
      expiresAt: '2026-08-16T18:00:00.000Z',
      radarAuthAttemptId: 'radar_attempt_1',
    })
    expect(JSON.stringify(result)).not.toContain('123456')
    expect(JSON.stringify(result)).not.toContain('magic_auth_secret_id')
    expect(mocks.createMagicAuth).toHaveBeenCalledWith({
      email: 'student@example.com',
      ipAddress: '203.0.113.10',
      userAgent: 'Pika test browser',
    })
    expect(mocks.deliverWorkOSMagicAuthCode).toHaveBeenCalledWith({
      email: 'student@example.com',
      code: '123456',
      delivery: 'brevo',
    })
  })

  it('fails before creating a WorkOS code when email delivery configuration is invalid', async () => {
    mocks.getWorkOSMagicAuthEmailDelivery.mockImplementationOnce(() => {
      throw new Error('invalid delivery configuration')
    })

    await expect(startWorkOSMagicAuth(
      'student@example.com',
      new Request('https://pika.codepet.ca/api/auth/workos/magic/start'),
    )).rejects.toThrow('invalid delivery configuration')
    expect(mocks.createMagicAuth).not.toHaveBeenCalled()
  })

  it('authenticates against the Pika client, preserves Radar, and discards cross-app codes', async () => {
    const response = {
      user: { id: 'user_1' },
      accessToken: 'access',
      refreshToken: 'refresh',
      authkit_authorization_code: 'authkit_authz_code_1',
    }
    mocks.authenticateWithMagicAuth.mockResolvedValue(response)
    const request = new Request('https://pika.codepet.ca/api/auth/workos/magic/verify')

    await expect(verifyWorkOSMagicAuth({
      email: 'student@example.com',
      code: '123456',
      radarAuthAttemptId: 'radar_attempt_1',
      request,
    })).resolves.toEqual(expect.objectContaining({
      user: response.user,
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
    }))
    expect(mocks.authenticateWithMagicAuth).toHaveBeenCalledWith({
      clientId: 'client_pika_test',
      email: 'student@example.com',
      code: '123456',
      radarAuthAttemptId: 'radar_attempt_1',
    })
  })

  it('does not add a cross-app code when the provider does not return one', async () => {
    mocks.authenticateWithMagicAuth.mockResolvedValue({
      user: { id: 'user_1' },
      accessToken: 'access',
      refreshToken: 'refresh',
    })

    const response = await verifyWorkOSMagicAuth({
      email: 'student@example.com',
      code: '123456',
      request: new Request('https://pika.codepet.ca/api/auth/workos/magic/verify'),
    })

    expect(response).not.toHaveProperty('authkitAuthorizationCode')
  })

  it('maps provider verification failures to a generic invalid-code response', () => {
    expect(() => mapWorkOSMagicAuthError({ status: 422, message: 'provider detail' }, 'verify'))
      .toThrowError(expect.objectContaining({
        statusCode: 401,
        message: 'Invalid or expired code',
      }))
  })

  it('preserves rate-limit semantics without leaking provider details', () => {
    expect(() => mapWorkOSMagicAuthError({ status: 429, message: 'provider detail' }, 'start'))
      .toThrowError(expect.objectContaining({
        statusCode: 429,
        message: 'Too many code requests. Please try again later.',
      }))
  })
})

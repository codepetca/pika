import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getWorkOSConfig,
  requireLegacyPasswordAuth,
  requireWorkOSMagicAuth,
  safePikaPath,
} from '@/lib/server/workos-config'

describe('WorkOS configuration', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('fails closed when environment-specific credentials are incomplete', () => {
    vi.stubEnv('PIKA_LEGACY_PASSWORD_AUTH', 'false')
    vi.stubEnv('WORKOS_CLIENT_ID', 'client_pika_test')
    vi.stubEnv('WORKOS_API_KEY', '')
    vi.stubEnv('WORKOS_COOKIE_PASSWORD', 'short')
    vi.stubEnv('SESSION_SECRET', 'short')

    expect(() => getWorkOSConfig()).toThrowError(expect.objectContaining({
      statusCode: 503,
    }))
    expect(() => requireWorkOSMagicAuth()).toThrowError(expect.objectContaining({
      statusCode: 503,
    }))
  })

  it('requires the Pika session secret before WorkOS can send a code', () => {
    vi.stubEnv('PIKA_LEGACY_PASSWORD_AUTH', 'false')
    vi.stubEnv('WORKOS_CLIENT_ID', 'client_pika_test')
    vi.stubEnv('WORKOS_API_KEY', 'sk_test_auth')
    vi.stubEnv('WORKOS_COOKIE_PASSWORD', 'workos-cookie-password-at-least-32-characters')
    vi.stubEnv('SESSION_SECRET', 'short')

    expect(() => requireWorkOSMagicAuth()).toThrowError(expect.objectContaining({
      statusCode: 503,
    }))
  })

  it('keeps legacy password authentication behind its explicit override', () => {
    vi.stubEnv('PIKA_LEGACY_PASSWORD_AUTH', 'false')
    expect(() => requireLegacyPasswordAuth()).toThrowError(expect.objectContaining({
      statusCode: 404,
    }))

    vi.stubEnv('PIKA_LEGACY_PASSWORD_AUTH', 'true')
    expect(() => requireLegacyPasswordAuth()).not.toThrow()
    expect(() => requireWorkOSMagicAuth()).toThrowError(expect.objectContaining({
      statusCode: 404,
    }))
  })

  it('accepts only relative Pika return paths', () => {
    expect(safePikaPath('/check-in/token')).toBe('/check-in/token')
    expect(safePikaPath('//evil.example')).toBe('/classrooms')
    expect(safePikaPath('/\\evil.example')).toBe('/classrooms')
    expect(safePikaPath('https://evil.example')).toBe('/classrooms')
    expect(safePikaPath(undefined)).toBe('/classrooms')
  })
})

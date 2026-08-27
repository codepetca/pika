import { describe, expect, it } from 'vitest'
import {
  isLegacyPasswordAuthEnabled,
  isWorkOSAuthKitConfigured,
  isWorkOSMagicAuthEnabled,
  shouldUseWorkOSAuthKit,
} from '@/lib/auth-mode'

const configuredWorkOS = {
  WORKOS_CLIENT_ID: 'client_test',
  WORKOS_API_KEY: 'sk_test_auth',
  WORKOS_COOKIE_PASSWORD: 'workos-cookie-password-at-least-32-characters',
  SESSION_SECRET: 'pika-session-secret-at-least-32-characters',
}

describe('authentication mode', () => {
  it('defaults to WorkOS Magic Auth when no legacy override is present', () => {
    const environment = {}

    expect(isWorkOSMagicAuthEnabled(environment)).toBe(true)
    expect(isLegacyPasswordAuthEnabled(environment)).toBe(false)
  })

  it('enables password authentication only through the explicit override', () => {
    const environment = { PIKA_LEGACY_PASSWORD_AUTH: 'true' }

    expect(isLegacyPasswordAuthEnabled(environment)).toBe(true)
    expect(isWorkOSMagicAuthEnabled(environment)).toBe(false)
  })

  it('starts AuthKit session handling only with complete WorkOS configuration', () => {
    expect(isWorkOSAuthKitConfigured(configuredWorkOS)).toBe(true)
    expect(shouldUseWorkOSAuthKit(configuredWorkOS)).toBe(true)
    expect(shouldUseWorkOSAuthKit({})).toBe(false)
    expect(isWorkOSAuthKitConfigured({
      ...configuredWorkOS,
      SESSION_SECRET: 'too-short',
    })).toBe(false)
    expect(shouldUseWorkOSAuthKit({
      ...configuredWorkOS,
      PIKA_LEGACY_PASSWORD_AUTH: 'true',
    })).toBe(false)
  })
})

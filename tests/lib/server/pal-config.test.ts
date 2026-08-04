import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getPalApiUrl,
  isPalEnabled,
  requirePalEnvironment,
  requirePalPseudonymSecret,
} from '@/lib/server/pal-config'

describe('Pal pilot configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is disabled unless the single environment flag is explicitly true', () => {
    expect(isPalEnabled()).toBe(false)

    vi.stubEnv('PAL_ENABLED', ' TRUE ')
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-32-characters-long')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-32-characters-long')
    expect(isPalEnabled()).toBe(true)

    vi.stubEnv('PAL_ENABLED', 'false')
    expect(isPalEnabled()).toBe(false)
  })

  it('loads server-only connection settings when configured', () => {
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test/')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-32-characters-long')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-32-characters-long')

    expect(requirePalEnvironment()).toEqual({
      apiUrl: 'https://pal.example.test',
      integrationSecret: 'integration-secret-32-characters-long',
      pseudonymSecret: 'pseudonym-secret-32-characters-long',
    })
  })

  it('fails closed when an enabled adapter is missing required settings', () => {
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
    vi.stubEnv('PAL_INTEGRATION_SECRET', '')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-32-characters-long')

    expect(() => requirePalEnvironment()).toThrow(
      'PAL_ENABLED requires PAL_API_URL, PAL_INTEGRATION_SECRET, and PAL_PSEUDONYM_SECRET',
    )
  })

  it('fails at the feature gate when enabled configuration is incomplete', () => {
    vi.stubEnv('PAL_ENABLED', 'true')
    expect(() => isPalEnabled()).toThrow(
      'PAL_ENABLED requires PAL_API_URL, PAL_INTEGRATION_SECRET, and PAL_PSEUDONYM_SECRET',
    )
  })

  it('allows event pseudonymization without loading delivery configuration', () => {
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-32-characters-long')
    expect(requirePalPseudonymSecret()).toBe('pseudonym-secret-32-characters-long')
  })

  it('rejects weak or shared integration secrets at the enabled boundary', () => {
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'too-short')
    vi.stubEnv(
      'PAL_PSEUDONYM_SECRET',
      'pseudonym-secret-32-characters-long-32-characters-long',
    )
    expect(() => requirePalEnvironment()).toThrow('at least 32 characters')

    vi.stubEnv(
      'PAL_INTEGRATION_SECRET',
      'shared-secret-value-that-is-long-enough',
    )
    vi.stubEnv(
      'PAL_PSEUDONYM_SECRET',
      'shared-secret-value-that-is-long-enough',
    )
    expect(() => requirePalEnvironment()).toThrow('must be distinct')
  })

  it.each(['pal.example.test', 'ftp://pal.example.test'])(
    'rejects an invalid Pal API URL: %s',
    (apiUrl) => {
      vi.stubEnv('PAL_API_URL', apiUrl)
      vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-32-characters-long')
      vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-32-characters-long')

      expect(() => requirePalEnvironment()).toThrow()
    },
  )

  it('exposes only the validated public Pal API origin to the learner page', () => {
    vi.stubEnv('PAL_ENABLED', 'true')
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test/')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-32-characters-long')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-32-characters-long')

    expect(getPalApiUrl()).toBe('https://pal.example.test')
  })

  it('contains invalid widget configuration instead of breaking academic pages', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubEnv('PAL_ENABLED', 'true')
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
    vi.stubEnv('PAL_INTEGRATION_SECRET', '')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-32-characters-long')

    expect(getPalApiUrl()).toBeNull()
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Pal widget is unavailable'),
      expect.any(Error),
    )
    consoleError.mockRestore()
  })

  it.each([
    'https://user:pass@pal.example.test',
    'https://pal.example.test/api',
    'https://pal.example.test/?tenant=pika',
    'https://pal.example.test/#embed',
  ])('rejects a URL that is not an origin: %s', (apiUrl) => {
    vi.stubEnv('PAL_API_URL', apiUrl)
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-32-characters-long')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-32-characters-long')

    expect(() => requirePalEnvironment()).toThrow(
      'PAL_API_URL must contain only an origin',
    )
  })

  it('rejects production HTTP origins', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('PAL_API_URL', 'http://pal.example.test')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-32-characters-long')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-32-characters-long')

    expect(() => requirePalEnvironment()).toThrow(
      'PAL_API_URL must use HTTPS',
    )
  })

  it('allows loopback HTTP only outside production', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('PAL_API_URL', 'http://localhost:3100/')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-32-characters-long')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-32-characters-long')

    expect(requirePalEnvironment().apiUrl).toBe('http://localhost:3100')
  })
})

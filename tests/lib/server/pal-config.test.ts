import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getPalEmbedUrl,
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
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret')
    expect(isPalEnabled()).toBe(true)

    vi.stubEnv('PAL_ENABLED', 'false')
    expect(isPalEnabled()).toBe(false)
  })

  it('loads server-only connection settings when configured', () => {
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test/')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret')

    expect(requirePalEnvironment()).toEqual({
      apiUrl: 'https://pal.example.test',
      integrationSecret: 'integration-secret',
      pseudonymSecret: 'pseudonym-secret',
    })
  })

  it('fails closed when an enabled adapter is missing required settings', () => {
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
    vi.stubEnv('PAL_INTEGRATION_SECRET', '')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret')

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
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret')
    expect(requirePalPseudonymSecret()).toBe('pseudonym-secret')
  })

  it.each(['pal.example.test', 'ftp://pal.example.test'])(
    'rejects an invalid Pal API URL: %s',
    (apiUrl) => {
      vi.stubEnv('PAL_API_URL', apiUrl)
      vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret')
      vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret')

      expect(() => requirePalEnvironment()).toThrow()
    },
  )

  it('exposes only the chrome-free public embed URL to the learner page', () => {
    vi.stubEnv('PAL_ENABLED', 'true')
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test/')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret')

    expect(getPalEmbedUrl()).toBe('https://pal.example.test/embed/roadmap')
  })

  it.each([
    'https://user:pass@pal.example.test',
    'https://pal.example.test/api',
    'https://pal.example.test/?tenant=pika',
    'https://pal.example.test/#embed',
  ])('rejects a URL that is not an origin: %s', (apiUrl) => {
    vi.stubEnv('PAL_API_URL', apiUrl)
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret')

    expect(() => requirePalEnvironment()).toThrow(
      'PAL_API_URL must contain only an origin',
    )
  })

  it('rejects production HTTP origins', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('PAL_API_URL', 'http://pal.example.test')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret')

    expect(() => requirePalEnvironment()).toThrow(
      'PAL_API_URL must use HTTPS',
    )
  })

  it('allows loopback HTTP only outside production', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('PAL_API_URL', 'http://localhost:3100/')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret')

    expect(requirePalEnvironment().apiUrl).toBe('http://localhost:3100')
  })
})

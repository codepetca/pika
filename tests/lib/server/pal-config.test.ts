import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getPalEmbedUrl,
  isPalEnabled,
  requirePalEnvironment,
} from '@/lib/server/pal-config'

describe('Pal pilot configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is disabled unless the single environment flag is explicitly true', () => {
    expect(isPalEnabled()).toBe(false)

    vi.stubEnv('PAL_ENABLED', ' TRUE ')
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

  it.each(['pal.example.test', 'ftp://pal.example.test'])(
    'rejects an invalid Pal API URL: %s',
    (apiUrl) => {
      vi.stubEnv('PAL_API_URL', apiUrl)
      vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret')
      vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret')

      expect(() => requirePalEnvironment()).toThrow(
        'PAL_API_URL must be a valid http or https URL',
      )
    },
  )

  it('exposes only the chrome-free public embed URL to the learner page', () => {
    vi.stubEnv('PAL_ENABLED', 'true')
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test/api/')

    expect(getPalEmbedUrl()).toBe('https://pal.example.test/embed/roadmap')
  })

  it('does not expose an embed URL for an invalid origin', () => {
    vi.stubEnv('PAL_ENABLED', 'true')
    vi.stubEnv('PAL_API_URL', 'javascript:alert(1)')

    expect(getPalEmbedUrl()).toBeNull()
  })
})

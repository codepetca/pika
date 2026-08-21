import { afterEach, describe, expect, it, vi } from 'vitest'
import { getWorkOSPilotConfig, safePikaPath } from '@/lib/server/workos-pilot'

describe('WorkOS pilot configuration', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('fails closed when environment-specific credentials are incomplete', () => {
    vi.stubEnv('WORKOS_CLIENT_ID', 'client_pika_test')
    vi.stubEnv('WORKOS_API_KEY', '')
    vi.stubEnv('WORKOS_COOKIE_PASSWORD', 'short')

    expect(() => getWorkOSPilotConfig()).toThrowError(expect.objectContaining({
      statusCode: 503,
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

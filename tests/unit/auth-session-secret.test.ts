import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('iron-session', () => ({
  getIronSession: vi.fn(() => Promise.resolve({})),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => Promise.resolve(new Map())),
}))

describe('auth session secret validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('should throw when SESSION_SECRET is missing/too short', async () => {
    vi.stubEnv('SESSION_SECRET', 'short-secret')
    vi.resetModules()

    await expect(import('@/lib/auth')).rejects.toThrow('SESSION_SECRET must be at least 32 characters')
  })
})


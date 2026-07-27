import { afterEach, describe, expect, it, vi } from 'vitest'

import { mintPalReadToken } from '@/lib/server/pal-read-token'

describe('Pal learner read token', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('mints a short-lived token without sending a raw Pika learner id', async () => {
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test/')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret')
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = String(init?.body)
      expect(body).not.toContain('raw-student-id')
      expect(JSON.parse(body)).toEqual({
        learner_id: expect.stringMatching(/^pika-learner-/),
      })
      return new Response(JSON.stringify({
        token: 'short-lived-token',
        expires_at: '2026-09-16T18:25:00.000Z',
      }))
    })

    await expect(mintPalReadToken({
      studentId: 'raw-student-id',
      fetchImpl,
      now: new Date('2026-09-16T18:20:00.000Z'),
    })).resolves.toEqual({
      token: 'short-lived-token',
      expires_at: '2026-09-16T18:25:00.000Z',
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://pal.example.test/api/v1/integration/read-token',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer integration-secret',
        }),
      }),
    )
  })

  it.each([
    ['2026-09-16T18:20:00.000Z', 'expired'],
    ['2026-09-16T18:31:00.000Z', 'maximum TTL'],
  ])('rejects an unsafe expiry at %s', async (expiresAt, message) => {
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret')
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      token: 'unsafe-token',
      expires_at: expiresAt,
    })))

    await expect(mintPalReadToken({
      studentId: 'student-id',
      fetchImpl,
      now: new Date('2026-09-16T18:20:00.000Z'),
    })).rejects.toThrow(message)
  })

  it('rejects malformed token responses', async () => {
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret')
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      token: '',
      expires_at: 'not-a-date',
    })))

    await expect(mintPalReadToken({
      studentId: 'student-id',
      fetchImpl,
      now: new Date('2026-09-16T18:20:00.000Z'),
    })).rejects.toThrow()
  })
})

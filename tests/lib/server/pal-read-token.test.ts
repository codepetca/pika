import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createPalReadTokenBroker,
  mintPalReadToken,
  PalReadTokenRateLimitError,
} from '@/lib/server/pal-read-token'

describe('Pal learner read token', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('mints a short-lived token without sending a raw Pika learner id', async () => {
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test/')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-32-characters-long')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-32-characters-long')
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
          Authorization: 'Bearer integration-secret-32-characters-long',
        }),
      }),
    )
  })

  it.each([
    ['2026-09-16T18:20:00.000Z', 'expired'],
    ['2026-09-16T18:31:00.000Z', 'maximum TTL'],
  ])('rejects an unsafe expiry at %s', async (expiresAt, message) => {
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-32-characters-long')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-32-characters-long')
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
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret-32-characters-long')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret-32-characters-long')
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

  it('coalesces a burst and reuses the token for one authenticated learner', async () => {
    let resolveMint: ((token: {
      token: string
      expires_at: string
    }) => void) | undefined
    const mint = vi.fn(() => new Promise<{
      token: string
      expires_at: string
    }>((resolve) => { resolveMint = resolve }))
    const getToken = createPalReadTokenBroker({
      mint,
      now: () => Date.parse('2026-09-16T18:20:00.000Z'),
      mintStarts: new Map(),
    })

    const burst = Array.from(
      { length: 20 },
      () => getToken({ studentId: 'student-1' }),
    )
    expect(mint).toHaveBeenCalledTimes(1)
    resolveMint?.({
      token: 'shared-token',
      expires_at: '2026-09-16T18:25:00.000Z',
    })

    await expect(Promise.all(burst)).resolves.toEqual(
      Array.from({ length: 20 }, () => ({
        token: 'shared-token',
        expires_at: '2026-09-16T18:25:00.000Z',
      })),
    )
    await expect(getToken({ studentId: 'student-1' })).resolves.toMatchObject({
      token: 'shared-token',
    })
    expect(mint).toHaveBeenCalledTimes(1)
  })

  it('isolates learners and refreshes when a token enters its safety buffer', async () => {
    let now = Date.parse('2026-09-16T18:20:00.000Z')
    const mint = vi.fn(async ({ studentId }: { studentId: string }) => ({
      token: `${studentId}-${mint.mock.calls.length}`,
      expires_at: '2026-09-16T18:25:00.000Z',
    }))
    const getToken = createPalReadTokenBroker({
      mint,
      now: () => now,
      mintStarts: new Map(),
    })

    await expect(getToken({ studentId: 'student-1' })).resolves.toMatchObject({
      token: 'student-1-1',
    })
    await expect(getToken({ studentId: 'student-2' })).resolves.toMatchObject({
      token: 'student-2-2',
    })
    now = Date.parse('2026-09-16T18:24:31.000Z')
    await getToken({ studentId: 'student-1' })

    expect(mint).toHaveBeenCalledTimes(3)
  })

  it('does not cache a failed mint after its retry backoff', async () => {
    let now = Date.parse('2026-09-16T18:20:00.000Z')
    const mint = vi.fn()
      .mockRejectedValueOnce(new Error('Pal unavailable'))
      .mockResolvedValueOnce({
        token: 'recovered-token',
        expires_at: '2026-09-16T18:25:00.000Z',
      })
    const getToken = createPalReadTokenBroker({
      mint,
      now: () => now,
      mintStarts: new Map(),
    })

    await expect(getToken({ studentId: 'student-1' })).rejects.toThrow(
      'Pal unavailable',
    )
    now += 30_000
    await expect(getToken({ studentId: 'student-1' })).resolves.toMatchObject({
      token: 'recovered-token',
    })
    expect(mint).toHaveBeenCalledTimes(2)
  })

  it('backs off repeated failures and short tokens across broker instances', async () => {
    let now = Date.parse('2026-09-16T18:20:00.000Z')
    const failedMint = vi.fn().mockRejectedValue(new Error('Pal unavailable'))
    const secondMint = vi.fn().mockResolvedValue({
      token: 'too-short-to-cache',
      expires_at: '2026-09-16T18:20:20.000Z',
    })
    const firstBroker = createPalReadTokenBroker({
      mint: failedMint,
      now: () => now,
    })
    const secondBroker = createPalReadTokenBroker({
      mint: secondMint,
      now: () => now,
    })

    await expect(firstBroker({ studentId: 'student-module-shared' })).rejects.toThrow(
      'Pal unavailable',
    )
    await expect(secondBroker({ studentId: 'student-module-shared' })).rejects
      .toEqual(new PalReadTokenRateLimitError(30))
    expect(secondMint).not.toHaveBeenCalled()

    now += 30_000
    await expect(secondBroker({ studentId: 'student-module-shared' })).resolves
      .toMatchObject({ token: 'too-short-to-cache' })
    await expect(firstBroker({ studentId: 'student-module-shared' })).rejects
      .toEqual(new PalReadTokenRateLimitError(30))
    expect(failedMint).toHaveBeenCalledTimes(1)
    expect(secondMint).toHaveBeenCalledTimes(1)
  })
})

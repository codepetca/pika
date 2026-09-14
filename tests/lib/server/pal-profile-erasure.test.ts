import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestPalProfileErasure, parsePalErasureReceipt } from '@/lib/server/pal-profile-erasure'
const binding = { operation_id: 'a0000000-0000-4000-8000-000000000001', learner_id: `pika-membership-v1-${'a'.repeat(32)}` }
const pending = { ...binding, schema_version: 1, status: 'pending', begun_at: '2026-09-13T15:00:00.000Z', completed_at: null }
const completed = { ...pending, status: 'completed', completed_at: '2026-09-13T15:01:00.000Z' }
beforeEach(() => {
  vi.stubEnv('PAL_PROFILE_ERASURE_ENABLED', 'true')
  vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
  vi.stubEnv('PAL_INTEGRATION_SECRET', 'synthetic-integration-secret-32-characters')
  vi.stubEnv('PAL_PSEUDONYM_SECRET', 'synthetic-pseudonym-secret-32-characters')
})
afterEach(() => vi.unstubAllEnvs())
describe('Pal exact membership erasure', () => {
  it.each(['', 'false', 'TRUE', '*'])('performs no network work under disabled gate %s', async gate => {
    vi.stubEnv('PAL_PROFILE_ERASURE_ENABLED', gate)
    const fetcher = vi.fn()
    await expect(requestPalProfileErasure('begin', binding, { fetcher })).rejects.toMatchObject({ code: 'disabled' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('sends exact saved binding, then reads status with no body', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(pending, { status: 202 }))
      .mockResolvedValueOnce(Response.json(completed))
    expect(await requestPalProfileErasure('begin', binding, { fetcher })).toEqual(pending)
    expect(await requestPalProfileErasure('status', binding, { fetcher })).toEqual(completed)
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify(binding), redirect: 'error', cache: 'no-store' })
    expect(fetcher.mock.calls[1][0]).toBe(`https://pal.example.test/api/v1/integration/profile-erasures/${binding.operation_id}`)
    expect(fetcher.mock.calls[1][1]?.body).toBeUndefined()
  })
  it.each([{ operation_id: 'b0000000-0000-4000-8000-000000000001' }, { learner_id: `pika-membership-v1-${'b'.repeat(32)}` },
    { schema_version: 2 }, { extra: true }, { status: 'pending' }, { completed_at: null },
    { completed_at: '2026-09-13T14:59:00Z' }, { begun_at: '2026-02-30T15:00:00Z' },
    { begun_at: '2026-09-13T15:00:00-04:00' }])('rejects malformed or foreign receipts %j', async patch => {
    expect(parsePalErasureReceipt({ ...completed, ...patch }, binding)).toBeNull()
    await expect(requestPalProfileErasure('begin', binding, { fetcher: vi.fn(async () => Response.json({ ...completed, ...patch })) }))
      .rejects.toMatchObject({ code: 'invalid_receipt', retryable: true })
  })
  it.each([202, 201, 206])('rejects completion returned with status %i', async status => {
    await expect(requestPalProfileErasure('begin', binding, { fetcher: vi.fn(async () => Response.json(completed, { status })) }))
      .rejects.toMatchObject({ code: 'invalid_receipt', retryable: true })
  })
  it.each([[404, true], [409, false], [401, false], [403, false], [422, false], [429, true], [503, true], [408, true]])('never treats HTTP %i as cleanup', async (status, retryable) => {
    await expect(requestPalProfileErasure('begin', binding, { fetcher: vi.fn(async () => Response.json({ error: 'sensitive_upstream_text' }, { status: Number(status) })) }))
      .rejects.toMatchObject({ code: 'remote_rejected', retryable })
  })
  it.each(['not JSON', 'x'.repeat(4097)])('retries unproven receipt bodies without changing operation identity', async body => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(body))
      .mockResolvedValueOnce(Response.json(pending, { status: 202 }))
    await expect(requestPalProfileErasure('begin', binding, { fetcher }))
      .rejects.toMatchObject({ code: 'invalid_receipt', retryable: true })
    expect(await requestPalProfileErasure('begin', binding, { fetcher })).toEqual(pending)
    expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[1][1]?.body)
  })
  it('preserves terminal authorization classification even with an oversized error body', async () => {
    await expect(requestPalProfileErasure('begin', binding, {
      fetcher: vi.fn(async () => new Response('x'.repeat(4097), { status: 403 })),
    })).rejects.toMatchObject({ code: 'remote_rejected', retryable: false, status: 403 })
  })
  it('keeps operation identity after lost response and never echoes the thrown error', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('secret token and learner content'))
      .mockResolvedValueOnce(Response.json(pending, { status: 202 }))
    await expect(requestPalProfileErasure('begin', binding, { fetcher })).rejects.toMatchObject({ code: 'network_error', retryable: true, message: 'Pal profile cleanup could not be verified' })
    expect(await requestPalProfileErasure('begin', binding, { fetcher })).toEqual(pending)
    expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[1][1]?.body)
  })
})

const liveBinding = { ...binding, schema_version: 2 as const, policy: 'pika-live-v1' as const }
const liveCompleted = { ...completed, schema_version: 2, policy: 'pika-live-v1', historical_backups: 'excluded', backup_retention: 'not_attested' }
describe('Pal live policy compatibility', () => {
  it('uses exact v2 POST and GET-only policy header with stable retries', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(liveCompleted))
    await requestPalProfileErasure('begin', liveBinding, { fetcher })
    await requestPalProfileErasure('status', liveBinding, { fetcher })
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual(liveBinding)
    expect(fetcher.mock.calls[0][1]!.headers).not.toHaveProperty('Pal-Erasure-Policy')
    expect(fetcher.mock.calls[1][1]!.headers).toHaveProperty('Pal-Erasure-Policy', 'pika-live-v1')
    expect(fetcher.mock.calls[1][1]!.body).toBeUndefined()
  })
  it('never upgrades strict receipts or accepts strict proof for a live operation', () => {
    expect(parsePalErasureReceipt(liveCompleted, binding)).toBeNull()
    expect(parsePalErasureReceipt(completed, liveBinding)).toBeNull()
  })
  it.each([{ policy: 'strict-v1' }, { historical_backups: 'erased' }, { backup_retention: '7 days' },
    { begun_at: '2026-09-13T15:00:00Z' }, { completed_at: '2026-09-13T15:01:00.0000Z' },
    { begun_at: '2026-02-30T15:00:00.000Z' }, { extra: true }, { status: 'pending' }])('fails closed for invalid live proof %j', patch => {
    expect(parsePalErasureReceipt({ ...liveCompleted, ...patch }, liveBinding)).toBeNull()
  })
})

it('retries identical v2 POST after a lost reply without sending the GET-only header', async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('lost reply'))
    .mockImplementationOnce(async () => Response.json(liveCompleted))
  await expect(requestPalProfileErasure('begin', liveBinding, { fetcher })).rejects.toMatchObject({ code: 'network_error' })
  expect(await requestPalProfileErasure('begin', liveBinding, { fetcher })).toEqual(liveCompleted)
  expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[1][1]?.body)
  expect(fetcher.mock.calls[1][1]?.headers).not.toHaveProperty('Pal-Erasure-Policy')
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDeliverPalOutboxBatch, mockSyncPalWeeklyConfigurations } = vi.hoisted(() => ({
  mockDeliverPalOutboxBatch: vi.fn(),
  mockSyncPalWeeklyConfigurations: vi.fn(),
}))

vi.mock('@/lib/server/pal-outbox', () => ({
  deliverPalOutboxBatch: mockDeliverPalOutboxBatch,
}))
vi.mock('@/lib/server/pal-weekly-config', () => ({
  syncPalWeeklyConfigurations: mockSyncPalWeeklyConfigurations,
}))

import { GET } from '@/app/api/cron/pal-sync/route'

describe('GET /api/cron/pal-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CRON_SECRET', 'cron-secret')
    mockSyncPalWeeklyConfigurations.mockResolvedValue({
      status: 'ok',
      configured: 2,
      closed: 1,
    })
    mockDeliverPalOutboxBatch.mockResolvedValue({
      status: 'ok',
      claimed: 3,
      delivered: 3,
      retrying: 0,
      nonRetryable: 0,
    })
  })

  it('requires cron authentication', async () => {
    const response = await GET(new Request('http://localhost/api/cron/pal-sync') as any, {
      params: Promise.resolve({}),
    })

    expect(response.status).toBe(401)
    expect(mockSyncPalWeeklyConfigurations).not.toHaveBeenCalled()
  })

  it('reconciles weekly opportunities before draining the delivery outbox', async () => {
    const response = await GET(new Request('http://localhost/api/cron/pal-sync', {
      headers: { Authorization: 'Bearer cron-secret' },
    }) as any, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      weekly: { status: 'ok', configured: 2, closed: 1 },
      delivery: {
        status: 'ok',
        claimed: 3,
        delivered: 3,
        retrying: 0,
        nonRetryable: 0,
      },
    })
    expect(mockSyncPalWeeklyConfigurations.mock.invocationCallOrder[0])
      .toBeLessThan(mockDeliverPalOutboxBatch.mock.invocationCallOrder[0])
  })

  it('still drains the delivery outbox when weekly reconciliation fails', async () => {
    mockSyncPalWeeklyConfigurations.mockRejectedValue(new Error('weekly unavailable'))

    const response = await GET(new Request('http://localhost/api/cron/pal-sync', {
      headers: { Authorization: 'Bearer cron-secret' },
    }) as any, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'partial',
      weekly: { status: 'error', error: 'weekly_sync_failed' },
      delivery: {
        status: 'ok',
        claimed: 3,
        delivered: 3,
        retrying: 0,
        nonRetryable: 0,
      },
    })
    expect(mockDeliverPalOutboxBatch).toHaveBeenCalledOnce()
  })

  it('reports a partial run when delivery fails after weekly reconciliation', async () => {
    mockDeliverPalOutboxBatch.mockRejectedValue(new Error('delivery unavailable'))

    const response = await GET(new Request('http://localhost/api/cron/pal-sync', {
      headers: { Authorization: 'Bearer cron-secret' },
    }) as any, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'partial',
      weekly: { status: 'ok', configured: 2, closed: 1 },
      delivery: { status: 'error', error: 'outbox_delivery_failed' },
    })
  })
})

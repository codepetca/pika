import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDrainPalOutbox, mockSyncPalWeeklyConfigurations } = vi.hoisted(() => ({
  mockDrainPalOutbox: vi.fn(),
  mockSyncPalWeeklyConfigurations: vi.fn(),
}))

vi.mock('@/lib/server/pal-outbox', () => ({
  drainPalOutbox: mockDrainPalOutbox,
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
      catchUpPeriods: 1,
      remainingCatchUp: false,
    })
    mockDrainPalOutbox.mockResolvedValue({
      status: 'ok',
      claimed: 3,
      delivered: 3,
      retrying: 0,
      nonRetryable: 0,
      batches: 1,
      remainingReady: 0,
      stoppedReason: 'drained',
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
      weekly: {
        status: 'ok',
        configured: 2,
        closed: 1,
        catchUpPeriods: 1,
        remainingCatchUp: false,
      },
      delivery: {
        status: 'ok',
        claimed: 3,
        delivered: 3,
        retrying: 0,
        nonRetryable: 0,
        batches: 1,
        remainingReady: 0,
        stoppedReason: 'drained',
      },
    })
    expect(mockSyncPalWeeklyConfigurations.mock.invocationCallOrder[0])
      .toBeLessThan(mockDrainPalOutbox.mock.invocationCallOrder[0])
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
        batches: 1,
        remainingReady: 0,
        stoppedReason: 'drained',
      },
    })
    expect(mockDrainPalOutbox).toHaveBeenCalledOnce()
  })

  it('reports a partial run when delivery fails after weekly reconciliation', async () => {
    mockDrainPalOutbox.mockRejectedValue(new Error('delivery unavailable'))

    const response = await GET(new Request('http://localhost/api/cron/pal-sync', {
      headers: { Authorization: 'Bearer cron-secret' },
    }) as any, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'partial',
      weekly: {
        status: 'ok',
        configured: 2,
        closed: 1,
        catchUpPeriods: 1,
        remainingCatchUp: false,
      },
      delivery: { status: 'error', error: 'outbox_delivery_failed' },
    })
  })
})

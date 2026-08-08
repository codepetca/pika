import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDeliverPalOutboxBatch,
  mockLoadPalOutboxStatus,
  mockRequeuePalOutboxEvent,
} = vi.hoisted(() => ({
  mockDeliverPalOutboxBatch: vi.fn(),
  mockLoadPalOutboxStatus: vi.fn(),
  mockRequeuePalOutboxEvent: vi.fn(),
}))

vi.mock('@/lib/server/pal-outbox', () => ({
  deliverPalOutboxBatch: mockDeliverPalOutboxBatch,
}))
vi.mock('@/lib/server/pal-operations', () => ({
  loadPalOutboxStatus: mockLoadPalOutboxStatus,
  requeuePalOutboxEvent: mockRequeuePalOutboxEvent,
}))

import { GET, PATCH, POST } from '@/app/api/cron/pal-outbox/route'

describe('POST /api/cron/pal-outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CRON_SECRET', 'cron-secret')
    mockDeliverPalOutboxBatch.mockResolvedValue({
      status: 'ok',
      claimed: 1,
      delivered: 1,
      retrying: 0,
      nonRetryable: 0,
    })
    mockLoadPalOutboxStatus.mockResolvedValue({
      enabled: true,
      counts: { pending: 2, processing: 0, delivered: 8, non_retryable: 1 },
      observability: {
        ready: 1,
        retrying: 1,
        expired_leases: 0,
        oldest_ready_at: '2026-08-08T15:50:00.000Z',
        oldest_ready_age_seconds: 600,
        delivery_latency_24h: {
          sample_size: 8,
          p50_ms: 120,
          p95_ms: 650,
          max_ms: 900,
        },
      },
      exceptions: [],
    })
  })

  it('requires cron authentication', async () => {
    const response = await POST(new Request('http://localhost/api/cron/pal-outbox', {
      method: 'POST',
    }) as any, { params: Promise.resolve({}) })

    expect(response.status).toBe(401)
    expect(mockDeliverPalOutboxBatch).not.toHaveBeenCalled()
  })

  it('runs one bounded delivery batch', async () => {
    const response = await POST(new Request('http://localhost/api/cron/pal-outbox', {
      method: 'POST',
      headers: { Authorization: 'Bearer cron-secret' },
    }) as any, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ delivered: 1 })
    expect(mockDeliverPalOutboxBatch).toHaveBeenCalledOnce()
  })

  it('returns privacy-safe adapter status under the same credential', async () => {
    const response = await GET(new Request('http://localhost/api/cron/pal-outbox', {
      headers: { Authorization: 'Bearer cron-secret' },
    }) as any, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      counts: { pending: 2, non_retryable: 1 },
      observability: {
        ready: 1,
        retrying: 1,
        expired_leases: 0,
        delivery_latency_24h: { p95_ms: 650 },
      },
    })
  })

  it('requeues a selected non-retryable event', async () => {
    mockRequeuePalOutboxEvent.mockResolvedValue(true)
    const response = await PATCH(new Request('http://localhost/api/cron/pal-outbox', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer cron-secret' },
      body: JSON.stringify({
        outbox_id: '10000000-0000-4000-8000-000000000001',
      }),
    }) as any, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(mockRequeuePalOutboxEvent).toHaveBeenCalledWith({
      outboxId: '10000000-0000-4000-8000-000000000001',
    })
  })
})

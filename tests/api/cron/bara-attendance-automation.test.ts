import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  syncSchedules: vi.fn(),
  deliverOutbox: vi.fn(),
  getOutboxHealth: vi.fn(),
  integrationState: vi.fn(),
  serviceClient: { rpc: vi.fn() },
}))

vi.mock('@/lib/server/bara-attendance-automation', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/server/bara-attendance-automation')>()
  return { ...original, syncBaraAttendanceSchedules: mocks.syncSchedules }
})
vi.mock('@/lib/server/bara-attendance-outbox', () => ({
  deliverBaraAttendanceOutboxBatch: mocks.deliverOutbox,
  getBaraAttendanceOutboxHealth: mocks.getOutboxHealth,
}))
vi.mock('@/lib/server/bara-attendance-client', () => ({
  getBaraAttendanceIntegrationState: mocks.integrationState,
}))
vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: () => mocks.serviceClient,
}))

import { GET, POST } from '@/app/api/cron/bara-attendance-automation/route'

function request(method: 'GET' | 'POST', authorized = true) {
  return new Request('http://localhost/api/cron/bara-attendance-automation', {
    method,
    headers: authorized ? { authorization: 'Bearer cron-test-secret' } : undefined,
  })
}

describe('/api/cron/bara-attendance-automation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'cron-test-secret'
    mocks.integrationState.mockReturnValue('ready')
    mocks.syncSchedules.mockResolvedValue({
      status: 'ok',
      windowStart: '2026-08-17',
      windowEnd: '2026-11-15',
      eligible: 2,
      attempted: 2,
      synced: 2,
      failed: 0,
      truncated: false,
      failures: {},
    })
    mocks.deliverOutbox.mockResolvedValue({
      status: 'ok',
      claimed: 0,
      delivered: 0,
      retrying: 0,
      nonRetryable: 0,
    })
    mocks.getOutboxHealth.mockResolvedValue({
      status: 'ok',
      pending: 0,
      processing: 0,
      nonRetryable: 0,
      due: 0,
      oldestUnresolvedAt: null,
    })
  })

  it('supports Vercel GET and an operator POST with the same secret boundary', async () => {
    expect((await GET(request('GET', false) as never)).status).toBe(401)
    expect(mocks.syncSchedules).not.toHaveBeenCalled()

    for (const [handler, method] of [[GET, 'GET'], [POST, 'POST']] as const) {
      const response = await handler(request(method) as never)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      await expect(response.json()).resolves.toMatchObject({
        status: 'ok',
        schedules: { synced: 2 },
        delivery: { delivered: 0 },
        health: { status: 'ok', pending: 0 },
      })
    }
    expect(mocks.syncSchedules).toHaveBeenCalledWith({
      supabase: mocks.serviceClient,
      integrationState: 'ready',
    })
    expect(mocks.deliverOutbox).toHaveBeenCalledWith({
      supabase: mocks.serviceClient,
      enabled: true,
      limit: 50,
    })
    expect(mocks.getOutboxHealth).toHaveBeenCalledWith({
      supabase: mocks.serviceClient,
      enabled: true,
    })
  })

  it('returns aggregate partial health when a target or durable delivery needs review', async () => {
    mocks.syncSchedules.mockResolvedValueOnce({
      status: 'partial',
      synced: 1,
      failed: 1,
    })
    mocks.deliverOutbox.mockResolvedValueOnce({
      status: 'partial',
      claimed: 1,
      delivered: 0,
      retrying: 0,
      nonRetryable: 1,
    })
    mocks.getOutboxHealth.mockResolvedValueOnce({
      status: 'degraded',
      pending: 1,
      processing: 0,
      nonRetryable: 1,
      due: 0,
      oldestUnresolvedAt: '2026-08-16T12:00:00+00:00',
    })

    const response = await GET(request('GET') as never)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ status: 'partial' })
  })
})

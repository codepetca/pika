import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  deliverBaraAttendanceOutboxBatch,
  getBaraAttendanceOutboxHealth,
  getBaraAttendanceCanaryScope,
  assertBaraAttendanceCanaryClassroomOwner,
  serviceClient,
} = vi.hoisted(() => ({
  deliverBaraAttendanceOutboxBatch: vi.fn(),
  getBaraAttendanceOutboxHealth: vi.fn(),
  getBaraAttendanceCanaryScope: vi.fn(),
  assertBaraAttendanceCanaryClassroomOwner: vi.fn(),
  serviceClient: { rpc: vi.fn() },
}))

vi.mock('@/lib/server/bara-attendance-outbox', () => ({
  deliverBaraAttendanceOutboxBatch,
  getBaraAttendanceOutboxHealth,
}))
vi.mock('@/lib/server/bara-attendance-canary', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/server/bara-attendance-canary')>()
  return {
    ...original,
    getBaraAttendanceCanaryScope,
    assertBaraAttendanceCanaryClassroomOwner,
  }
})
vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: () => serviceClient,
}))

import { POST } from '@/app/api/cron/bara-attendance-outbox/route'
import { BaraAttendanceCanaryError } from '@/lib/server/bara-attendance-canary'

describe('POST /api/cron/bara-attendance-outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'cron-test-secret'
    getBaraAttendanceCanaryScope.mockReturnValue({
      state: 'ready',
      teacherId: '10000000-0000-4000-8000-000000000001',
      classroomId: '20000000-0000-4000-8000-000000000002',
    })
    assertBaraAttendanceCanaryClassroomOwner.mockResolvedValue(undefined)
    deliverBaraAttendanceOutboxBatch.mockResolvedValue({
      status: 'ok',
      claimed: 1,
      delivered: 1,
      retrying: 0,
      nonRetryable: 0,
    })
    getBaraAttendanceOutboxHealth.mockResolvedValue({
      status: 'ok',
      pending: 0,
      processing: 0,
      nonRetryable: 0,
      due: 0,
      oldestUnresolvedAt: null,
    })
  })

  it('rejects requests without the cron bearer secret', async () => {
    const response = await POST(new Request('http://localhost/api/cron/bara-attendance-outbox', {
      method: 'POST',
    }))

    expect(response.status).toBe(401)
    expect(deliverBaraAttendanceOutboxBatch).not.toHaveBeenCalled()
  })

  it('delivers a bounded batch only when the integration is ready', async () => {
    const response = await POST(new Request('http://localhost/api/cron/bara-attendance-outbox', {
      method: 'POST',
      headers: { authorization: 'Bearer cron-test-secret' },
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      delivery: { delivered: 1 },
      health: { status: 'ok' },
    })
    expect(deliverBaraAttendanceOutboxBatch).toHaveBeenCalledWith({
      supabase: serviceClient,
      enabled: true,
      teacherId: '10000000-0000-4000-8000-000000000001',
      classroomId: '20000000-0000-4000-8000-000000000002',
    })
    expect(getBaraAttendanceOutboxHealth).toHaveBeenCalledWith({
      supabase: serviceClient,
      enabled: true,
      teacherId: '10000000-0000-4000-8000-000000000001',
      classroomId: '20000000-0000-4000-8000-000000000002',
    })
  })

  it('returns an unhealthy status when retry or dead-letter work remains', async () => {
    deliverBaraAttendanceOutboxBatch.mockResolvedValueOnce({
      status: 'partial',
      claimed: 1,
      delivered: 0,
      retrying: 1,
      nonRetryable: 0,
    })
    getBaraAttendanceOutboxHealth.mockResolvedValueOnce({
      status: 'degraded',
      pending: 1,
      processing: 0,
      nonRetryable: 0,
      due: 0,
      oldestUnresolvedAt: '2026-08-16T12:00:00+00:00',
    })

    const response = await POST(new Request('http://localhost/api/cron/bara-attendance-outbox', {
      method: 'POST',
      headers: { authorization: 'Bearer cron-test-secret' },
    }))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ status: 'partial' })
  })

  it('does not lease work when the configured classroom is not owned by the teacher', async () => {
    assertBaraAttendanceCanaryClassroomOwner.mockRejectedValue(
      new BaraAttendanceCanaryError('not_configured'),
    )

    const response = await POST(new Request('http://localhost/api/cron/bara-attendance-outbox', {
      method: 'POST',
      headers: { authorization: 'Bearer cron-test-secret' },
    }))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      status: 'error', error: 'not_configured',
    })
    expect(deliverBaraAttendanceOutboxBatch).not.toHaveBeenCalled()
  })
})

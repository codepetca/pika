import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  reconcile: vi.fn(),
  canaryScope: vi.fn(),
  assertOwner: vi.fn(),
  serviceClient: { rpc: vi.fn() },
}))

vi.mock('@/lib/server/bara-attendance-reconciliation', () => ({
  reconcileBaraAttendanceSessions: mocks.reconcile,
}))
vi.mock('@/lib/server/bara-attendance-canary', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/server/bara-attendance-canary')>()
  return {
    ...original,
    getBaraAttendanceCanaryScope: mocks.canaryScope,
    assertBaraAttendanceCanaryClassroomOwner: mocks.assertOwner,
  }
})
vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: () => mocks.serviceClient,
}))

import { GET, POST } from '@/app/api/cron/bara-attendance-reconciliation/route'
import { BaraAttendanceCanaryError } from '@/lib/server/bara-attendance-canary'

function request(method: 'GET' | 'POST', authorized = true) {
  return new Request('http://localhost/api/cron/bara-attendance-reconciliation', {
    method,
    headers: authorized ? { authorization: 'Bearer cron-test-secret' } : undefined,
  })
}

describe('/api/cron/bara-attendance-reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'cron-test-secret'
    mocks.canaryScope.mockReturnValue({
      state: 'ready',
      teacherId: '10000000-0000-4000-8000-000000000001',
      classroomId: '20000000-0000-4000-8000-000000000002',
      scopeMode: 'exact_canary',
    })
    mocks.assertOwner.mockResolvedValue(undefined)
    mocks.reconcile.mockResolvedValue({
      status: 'ok',
      eligible: 2,
      attempted: 2,
      reconciled: 2,
      failed: 0,
      truncated: false,
    })
  })

  it('supports protected Vercel GET and operator POST without exposing targets', async () => {
    expect((await GET(request('GET', false) as never)).status).toBe(401)
    expect(mocks.reconcile).not.toHaveBeenCalled()

    for (const [handler, method] of [[GET, 'GET'], [POST, 'POST']] as const) {
      const response = await handler(request(method) as never)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      const body = await response.json()
      expect(body).toEqual({
        status: 'ok',
        eligible: 2,
        attempted: 2,
        reconciled: 2,
        failed: 0,
        truncated: false,
      })
      expect(JSON.stringify(body)).not.toContain('occurrence_')
    }
    expect(mocks.reconcile).toHaveBeenCalledWith({
      supabase: mocks.serviceClient,
      enabled: true,
      teacherId: '10000000-0000-4000-8000-000000000001',
      classroomId: '20000000-0000-4000-8000-000000000002',
      scopeMode: 'exact_canary',
    })
  })

  it('returns HTTP 503 when authoritative recovery is incomplete', async () => {
    mocks.reconcile.mockResolvedValueOnce({
      status: 'partial',
      eligible: 51,
      attempted: 50,
      reconciled: 49,
      failed: 1,
      truncated: true,
    })

    const response = await GET(request('GET') as never)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      status: 'partial',
      failed: 1,
      truncated: true,
    })
  })

  it('does not reconcile when the configured pair is missing or inactive', async () => {
    mocks.assertOwner.mockRejectedValue(new BaraAttendanceCanaryError('not_configured'))

    const response = await GET(request('GET') as never)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      status: 'error', error: 'not_configured',
    })
    expect(mocks.reconcile).not.toHaveBeenCalled()
  })
})

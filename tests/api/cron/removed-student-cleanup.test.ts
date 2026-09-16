import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ enabled: vi.fn(), run: vi.fn() }))
vi.mock('@/lib/server/automatic-removed-student-cleanup', () => ({
  AUTOMATIC_REMOVED_STUDENT_CLEANUP_MAX_ADVANCES: 10,
  AUTOMATIC_REMOVED_STUDENT_CLEANUP_MAX_CLAIMS: 3,
  AUTOMATIC_REMOVED_STUDENT_CLEANUP_TIME_BUDGET_MS: 45000,
  isAutomaticRemovedStudentCleanupEnabled: mocks.enabled,
  runAutomaticRemovedStudentCleanup: mocks.run,
}))
import { GET, POST } from '@/app/api/cron/removed-student-cleanup/route'

const request = (method: 'GET'|'POST' = 'POST', token = 'secret') => new NextRequest(
  'http://localhost/api/cron/removed-student-cleanup', {
    method, headers: { authorization: `Bearer ${token}` }, body: method === 'POST' ? '{}' : undefined,
  })

describe('automatic removed-student cleanup trigger', () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.unstubAllEnvs(); vi.stubEnv('CRON_SECRET', 'secret')
    mocks.enabled.mockReturnValue(true)
    mocks.run.mockResolvedValue({ ok: true, status: 200, claimed: 0, completed: 0,
      pending: 0, failed: 0, retry_recording_failed: 0 })
  })
  it('fails closed when the shared secret is missing or wrong', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await POST(request())).status).toBe(500)
    vi.stubEnv('CRON_SECRET', 'secret')
    expect((await POST(request('POST','wrong'))).status).toBe(401)
    expect(mocks.enabled).not.toHaveBeenCalled()
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('retains an independent default-off automatic gate', async () => {
    mocks.enabled.mockReturnValue(false)
    expect((await POST(request())).status).toBe(503)
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it.each(['GET','POST'] as const)('runs the same bounded worker through %s', async method => {
    expect((await (method === 'GET' ? GET : POST)(request(method))).status).toBe(200)
    expect(mocks.run).toHaveBeenCalledWith({ maxClaims: 3, maxAdvances: 10, timeBudgetMs: 45000 })
  })
  it('propagates unhealthy retry evidence', async () => {
    mocks.run.mockResolvedValue({ ok: false, status: 503,
      error_code: 'automatic_cleanup_retry_evidence_unavailable', claimed: 1,
      completed: 0, pending: 0, failed: 1, retry_recording_failed: 1 })
    expect((await POST(request())).status).toBe(503)
  })
})

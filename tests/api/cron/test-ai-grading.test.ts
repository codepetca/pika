import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  tick: vi.fn(),
  maybeSingle: vi.fn(),
  log: vi.fn(),
}))
vi.mock('next/server', async (importOriginal) => ({
  ...await importOriginal<typeof import('next/server')>(),
  after: mocks.after,
}))
vi.mock('@/lib/server/test-ai-grading-runs', () => ({ tickTestAiGradingRun: mocks.tick }))
vi.mock('@/lib/server/diagnostics', () => ({ logServerError: mocks.log }))
vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
  }),
}))

import { POST } from '@/app/api/cron/test-ai-grading/route'

const runId = '10000000-0000-4000-8000-000000000001'
function request(token = 'secret', body: unknown = { run_id: runId }) {
  return new NextRequest('http://localhost/api/cron/test-ai-grading', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('test AI grading background wake', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('CRON_SECRET', 'secret')
    mocks.maybeSingle.mockResolvedValue({ data: { test_id: 'test-1', status: 'running' }, error: null })
  })

  it('rejects unauthorized and malformed wakes before scheduling work', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await POST(request())).status).toBe(503)
    vi.stubEnv('CRON_SECRET', 'secret')
    expect((await POST(request('wrong'))).status).toBe(401)
    expect((await POST(request('secret', { run_id: 'not-a-uuid' }))).status).toBe(400)
    expect(mocks.after).not.toHaveBeenCalled()
  })

  it('does not schedule a completed run', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { test_id: 'test-1', status: 'completed' }, error: null })
    expect((await POST(request())).status).toBe(200)
    expect(mocks.after).not.toHaveBeenCalled()
  })

  it('acknowledges promptly and runs one bounded tick after the response', async () => {
    const response = await POST(request())
    expect(response.status).toBe(202)
    expect(mocks.after).toHaveBeenCalledOnce()
    expect(mocks.tick).not.toHaveBeenCalled()

    await mocks.after.mock.calls[0][0]()
    expect(mocks.tick).toHaveBeenCalledWith({ testId: 'test-1', runId })
  })

  it('reports a failed background tick without exposing the worker response', async () => {
    mocks.tick.mockRejectedValueOnce(new Error('private failure'))
    expect((await POST(request())).status).toBe(202)
    await mocks.after.mock.calls[0][0]()
    expect(mocks.log).toHaveBeenCalledWith('grading.test_background_tick', expect.any(Error))
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  runWorker: vi.fn(),
}))

vi.mock('@/lib/server/assignment-ai-grading-worker', () => ({
  runAssignmentAiGradingWorker: mocks.runWorker,
}))

import { GET, POST } from '@/app/api/cron/assignment-ai-grading-runs/route'

function request(secret?: string, method = 'GET') {
  return new NextRequest('http://localhost:3000/api/cron/assignment-ai-grading-runs', {
    method,
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })
}

describe('assignment AI grading worker cron', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret'
    process.env.ASSIGNMENT_AI_GRADING_WORKER_SECRET = 'worker-secret'
    process.env.ASSIGNMENT_AI_GRADING_WORKER_ENABLED = 'true'
    mocks.runWorker.mockResolvedValue({ attempted: 1, claimed: 1, failed: 0 })
  })

  it('rejects unauthorized requests before running work', async () => {
    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(mocks.runWorker).not.toHaveBeenCalled()
  })

  it('fails closed when the worker gate is disabled', async () => {
    process.env.ASSIGNMENT_AI_GRADING_WORKER_ENABLED = 'false'

    const response = await GET(request('worker-secret'))
    const data = await response.json()

    expect(response.status).toBe(503)
    expect(data).toEqual({
      ok: false,
      error_code: 'assignment_ai_grading_worker_not_enabled',
      error: 'Assignment AI grading worker is not enabled',
    })
    expect(mocks.runWorker).not.toHaveBeenCalled()
  })

  it('runs one bounded tick through GET and POST', async () => {
    const getResponse = await GET(request('worker-secret'))
    const postResponse = await POST(request('worker-secret', 'POST'))

    expect(getResponse.status).toBe(200)
    expect(postResponse.status).toBe(200)
    expect(await getResponse.json()).toEqual({
      ok: true,
      attempted: 1,
      claimed: 1,
      failed: 0,
    })
    expect(mocks.runWorker).toHaveBeenCalledTimes(2)
  })

  it('returns unhealthy when a runnable run fails', async () => {
    mocks.runWorker.mockResolvedValueOnce({ attempted: 1, claimed: 1, failed: 1 })

    const response = await GET(request('worker-secret'))

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      ok: false,
      attempted: 1,
      claimed: 1,
      failed: 1,
    })
  })

  it('does not accept the shared cron secret', async () => {
    const response = await GET(request('cron-secret'))

    expect(response.status).toBe(401)
    expect(mocks.runWorker).not.toHaveBeenCalled()
  })
})

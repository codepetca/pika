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
    process.env.ASSIGNMENT_AI_GRADING_WORKER_ENABLED = 'true'
    delete process.env.ASSIGNMENT_AI_GRADING_WORKER_LIMIT
    mocks.runWorker.mockResolvedValue({ attempted: 2, claimed: 2, failed: 0 })
  })

  it('rejects unauthorized requests before running work', async () => {
    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(mocks.runWorker).not.toHaveBeenCalled()
  })

  it('fails closed when the worker gate is disabled', async () => {
    process.env.ASSIGNMENT_AI_GRADING_WORKER_ENABLED = 'false'

    const response = await GET(request('cron-secret'))
    const data = await response.json()

    expect(response.status).toBe(503)
    expect(data).toEqual({
      ok: false,
      error_code: 'assignment_ai_grading_worker_not_enabled',
      error: 'Assignment AI grading worker is not enabled',
    })
    expect(mocks.runWorker).not.toHaveBeenCalled()
  })

  it('runs a bounded batch through GET and POST', async () => {
    process.env.ASSIGNMENT_AI_GRADING_WORKER_LIMIT = '1'

    const getResponse = await GET(request('cron-secret'))
    const postResponse = await POST(request('cron-secret', 'POST'))

    expect(getResponse.status).toBe(200)
    expect(postResponse.status).toBe(200)
    expect(await getResponse.json()).toEqual({
      ok: true,
      attempted: 2,
      claimed: 2,
      failed: 0,
    })
    expect(mocks.runWorker).toHaveBeenNthCalledWith(1, { limit: 1 })
    expect(mocks.runWorker).toHaveBeenNthCalledWith(2, { limit: 1 })
  })

  it('returns unhealthy when a runnable run fails', async () => {
    mocks.runWorker.mockResolvedValueOnce({ attempted: 2, claimed: 1, failed: 1 })

    const response = await GET(request('cron-secret'))

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      ok: false,
      attempted: 2,
      claimed: 1,
      failed: 1,
    })
  })

  it('uses the safe default for an invalid configured limit', async () => {
    process.env.ASSIGNMENT_AI_GRADING_WORKER_LIMIT = '99'

    await GET(request('cron-secret'))

    expect(mocks.runWorker).toHaveBeenCalledWith({ limit: 2 })
  })
})

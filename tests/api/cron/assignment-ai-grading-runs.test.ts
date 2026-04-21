import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { listRunnableAssignmentAiGradingRuns, tickAssignmentAiGradingRun } = vi.hoisted(() => ({
  listRunnableAssignmentAiGradingRuns: vi.fn(),
  tickAssignmentAiGradingRun: vi.fn(),
}))

vi.mock('@/lib/server/assignment-ai-grading-runs', () => ({
  listRunnableAssignmentAiGradingRuns,
  tickAssignmentAiGradingRun,
}))

import { POST } from '@/app/api/cron/assignment-ai-grading-runs/route'

describe('POST /api/cron/assignment-ai-grading-runs', () => {
  const originalCronSecret = process.env.CRON_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-secret'
    listRunnableAssignmentAiGradingRuns.mockResolvedValue([
      {
        id: 'run-1',
        assignment_id: 'assignment-1',
        status: 'running',
      },
      {
        id: 'run-2',
        assignment_id: 'assignment-2',
        status: 'queued',
      },
    ])
    tickAssignmentAiGradingRun
      .mockResolvedValueOnce({
        claimed: true,
        run: { status: 'completed' },
      })
      .mockResolvedValueOnce({
        claimed: false,
        run: { status: 'running' },
      })
  })

  afterEach(() => {
    process.env.CRON_SECRET = originalCronSecret
  })

  it('processes up to three active runs when authorized', async () => {
    const request = new NextRequest('http://localhost:3000/api/cron/assignment-ai-grading-runs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-secret',
      },
    })

    const response = await POST(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      processed_runs: 2,
      claimed_runs: 1,
      completed_runs: 1,
    })
    expect(listRunnableAssignmentAiGradingRuns).toHaveBeenCalledWith(3)
    expect(tickAssignmentAiGradingRun).toHaveBeenNthCalledWith(1, {
      assignmentId: 'assignment-1',
      runId: 'run-1',
    })
    expect(tickAssignmentAiGradingRun).toHaveBeenNthCalledWith(2, {
      assignmentId: 'assignment-2',
      runId: 'run-2',
    })
  })

  it('rejects unauthorized cron requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/cron/assignment-ai-grading-runs', {
      method: 'POST',
    })

    const response = await POST(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
  })
})

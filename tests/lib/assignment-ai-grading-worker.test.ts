import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listRuns: vi.fn(),
  tickRun: vi.fn(),
}))

vi.mock('@/lib/server/assignment-ai-grading-runs', () => ({
  listRunnableAssignmentAiGradingRuns: mocks.listRuns,
  tickAssignmentAiGradingRun: mocks.tickRun,
}))

import { runAssignmentAiGradingWorker } from '@/lib/server/assignment-ai-grading-worker'

function run(id: string, assignmentId = `assignment-${id}`) {
  return {
    id,
    assignment_id: assignmentId,
    status: 'running' as const,
    model: 'gradex:pika-assignment-v1',
    requested_count: 1,
    gradable_count: 1,
    processed_count: 0,
    completed_count: 0,
    skipped_missing_count: 0,
    skipped_empty_count: 0,
    failed_count: 0,
    pending_count: 1,
    next_retry_at: null,
    error_samples: [],
    started_at: null,
    completed_at: null,
    created_at: '2026-07-20T12:00:00.000Z',
  }
}

describe('assignment AI grading worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ticks a bounded runnable batch sequentially', async () => {
    mocks.listRuns.mockResolvedValue([run('run-1'), run('run-2')])
    const callOrder: string[] = []
    mocks.tickRun.mockImplementation(async ({ runId }: { runId: string }) => {
      callOrder.push(runId)
      return { claimed: runId === 'run-1', run: run(runId) }
    })

    const result = await runAssignmentAiGradingWorker({ limit: 2 })

    expect(mocks.listRuns).toHaveBeenCalledWith(2)
    expect(callOrder).toEqual(['run-1', 'run-2'])
    expect(result).toEqual({ attempted: 2, claimed: 1, failed: 0 })
  })

  it('continues after one runnable run fails', async () => {
    mocks.listRuns.mockResolvedValue([run('run-1'), run('run-2')])
    mocks.tickRun
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce({ claimed: true, run: run('run-2') })

    const result = await runAssignmentAiGradingWorker({ limit: 2 })

    expect(mocks.tickRun).toHaveBeenNthCalledWith(2, {
      assignmentId: 'assignment-run-2',
      runId: 'run-2',
    })
    expect(result).toEqual({ attempted: 2, claimed: 1, failed: 1 })
  })

  it('rejects unbounded limits', async () => {
    await expect(runAssignmentAiGradingWorker({ limit: 0 })).rejects.toThrow(
      'Assignment AI grading worker limit must be between 1 and 2',
    )
    await expect(runAssignmentAiGradingWorker({ limit: 3 })).rejects.toThrow(
      'Assignment AI grading worker limit must be between 1 and 2',
    )
    expect(mocks.listRuns).not.toHaveBeenCalled()
  })
})

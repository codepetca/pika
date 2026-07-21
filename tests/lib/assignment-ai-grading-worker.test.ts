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

  it('ticks one runnable Gradex run', async () => {
    mocks.listRuns.mockResolvedValue([run('run-1')])
    mocks.tickRun.mockResolvedValue({ claimed: true, run: run('run-1') })

    const result = await runAssignmentAiGradingWorker()

    expect(mocks.listRuns).toHaveBeenCalledWith(1)
    expect(mocks.tickRun).toHaveBeenCalledWith({
      assignmentId: 'assignment-run-1',
      runId: 'run-1',
    })
    expect(result).toEqual({ attempted: 1, claimed: 1, failed: 0 })
  })

  it('reports a thrown tick failure', async () => {
    mocks.listRuns.mockResolvedValue([run('run-1')])
    mocks.tickRun.mockRejectedValueOnce(new Error('provider unavailable'))

    const result = await runAssignmentAiGradingWorker()

    expect(result).toEqual({ attempted: 1, claimed: 0, failed: 1 })
  })

  it('reports a terminal run returned by the tick', async () => {
    mocks.listRuns.mockResolvedValue([run('run-1')])
    mocks.tickRun.mockResolvedValue({
      claimed: true,
      run: { ...run('run-1'), status: 'failed' },
    })

    const result = await runAssignmentAiGradingWorker()

    expect(result).toEqual({ attempted: 1, claimed: 1, failed: 1 })
  })
})

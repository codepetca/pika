import {
  listRunnableAssignmentAiGradingRuns,
  tickAssignmentAiGradingRun,
} from '@/lib/server/assignment-ai-grading-runs'

const MAX_ASSIGNMENT_AI_GRADING_WORKER_LIMIT = 2

export type AssignmentAiGradingWorkerResult = {
  attempted: number
  claimed: number
  failed: number
}

export async function runAssignmentAiGradingWorker({
  limit,
}: {
  limit: number
}): Promise<AssignmentAiGradingWorkerResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ASSIGNMENT_AI_GRADING_WORKER_LIMIT) {
    throw new Error(
      `Assignment AI grading worker limit must be between 1 and ${MAX_ASSIGNMENT_AI_GRADING_WORKER_LIMIT}`,
    )
  }

  const runs = await listRunnableAssignmentAiGradingRuns(limit)
  let claimed = 0
  let failed = 0

  // Keep provider traffic and serverless duration bounded. Database leases make this safe
  // alongside page-driven ticks and overlapping worker invocations.
  for (const run of runs) {
    try {
      const result = await tickAssignmentAiGradingRun({
        assignmentId: run.assignment_id,
        runId: run.id,
      })
      if (result.claimed) claimed += 1
    } catch (error) {
      failed += 1
      console.error('[assignment-ai-grading-worker] run failed', {
        error: error instanceof Error ? error.message : 'Unknown worker error',
      })
    }
  }

  return {
    attempted: runs.length,
    claimed,
    failed,
  }
}

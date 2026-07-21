import {
  listRunnableAssignmentAiGradingRuns,
  tickAssignmentAiGradingRun,
} from '@/lib/server/assignment-ai-grading-runs'

const ASSIGNMENT_AI_GRADING_WORKER_LIMIT = 1

export type AssignmentAiGradingWorkerResult = {
  attempted: number
  claimed: number
  failed: number
}

export async function runAssignmentAiGradingWorker(): Promise<AssignmentAiGradingWorkerResult> {
  const runs = await listRunnableAssignmentAiGradingRuns(ASSIGNMENT_AI_GRADING_WORKER_LIMIT)
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
      if (result.run.status === 'failed') {
        failed += 1
        console.error('[assignment-ai-grading-worker] run reached terminal failure')
      }
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

import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import {
  listRunnableAssignmentAiGradingRuns,
  tickAssignmentAiGradingRun,
} from '@/lib/server/assignment-ai-grading-runs'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

function getCronAuthHeader(request: NextRequest): string | null {
  return request.headers.get('authorization') ?? request.headers.get('Authorization')
}

export const POST = withErrorHandler('PostCronAssignmentAiGradingRuns', async (request) => {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  const authHeader = getCronAuthHeader(request)
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runs = await listRunnableAssignmentAiGradingRuns(3)
  const results = await Promise.all(
    runs.map(async (run) =>
      tickAssignmentAiGradingRun({
        assignmentId: run.assignment_id,
        runId: run.id,
      }),
    ),
  )

  return NextResponse.json({
    processed_runs: results.length,
    claimed_runs: results.filter((result) => result.claimed).length,
    completed_runs: results.filter((result) =>
      ['completed', 'completed_with_errors', 'failed'].includes(result.run.status),
    ).length,
  })
})

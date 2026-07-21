import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { runAssignmentAiGradingWorker } from '@/lib/server/assignment-ai-grading-worker'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

const DEFAULT_WORKER_LIMIT = 2
const MAX_WORKER_LIMIT = 2

function resolveWorkerLimit() {
  const parsed = Number(process.env.ASSIGNMENT_AI_GRADING_WORKER_LIMIT)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_WORKER_LIMIT
    ? parsed
    : DEFAULT_WORKER_LIMIT
}

async function handle(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (process.env.ASSIGNMENT_AI_GRADING_WORKER_ENABLED?.trim().toLowerCase() !== 'true') {
    return NextResponse.json({
      ok: false,
      error_code: 'assignment_ai_grading_worker_not_enabled',
      error: 'Assignment AI grading worker is not enabled',
    }, { status: 503 })
  }

  const result = await runAssignmentAiGradingWorker({ limit: resolveWorkerLimit() })
  return NextResponse.json({ ok: result.failed === 0, ...result }, {
    status: result.failed === 0 ? 200 : 503,
  })
}

export const GET = withErrorHandler(
  'GetCronAssignmentAiGradingRuns',
  async (request: NextRequest) => handle(request),
)

export const POST = withErrorHandler(
  'PostCronAssignmentAiGradingRuns',
  async (request: NextRequest) => handle(request),
)

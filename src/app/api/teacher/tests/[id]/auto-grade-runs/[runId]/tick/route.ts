import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { tickTestAiGradingRun } from '@/lib/server/test-ai-grading-runs'

export const dynamic = 'force-dynamic'
export const revalidate = 0
// Sized with TEST_AI_GRADING_TICK_BUDGET_MS: one heavy answer plus a retry can take about a
// minute, which the old 60s could not fit. Ticks stop starting calls long before this.
export const maxDuration = 300

export const POST = withErrorHandler('PostTeacherTestAutoGradeRunTick', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: testId, runId } = await context.params

  const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  if (access.test.status === 'draft') {
    return NextResponse.json({ error: 'Cannot grade a draft test' }, { status: 400 })
  }

  const result = await tickTestAiGradingRun({ testId, runId })
  return NextResponse.json({
    run: result.run,
    claimed: result.claimed,
  })
})

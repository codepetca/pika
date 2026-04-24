import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { tickTestAiGradingRun } from '@/lib/server/test-ai-grading-runs'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

export const POST = withErrorHandler('PostTeacherTestAutoGradeRunTick', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: testId, runId } = await context.params

  const access = await assertTeacherOwnsTest(user.id, testId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const result = await tickTestAiGradingRun({ testId, runId })
  return NextResponse.json({
    run: result.run,
    claimed: result.claimed,
  })
})

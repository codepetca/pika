import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { getTestAiGradingRunSummary } from '@/lib/server/test-ai-grading-runs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetTeacherTestAutoGradeRun', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: testId, runId } = await context.params

  const access = await assertTeacherOwnsTest(user.id, testId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const run = await getTestAiGradingRunSummary({ testId, runId })
  if (!run) {
    return NextResponse.json({ error: 'Test AI grading run not found' }, { status: 404 })
  }

  return NextResponse.json({ run })
})

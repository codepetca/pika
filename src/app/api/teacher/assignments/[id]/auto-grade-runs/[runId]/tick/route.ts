import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { tickAssignmentAiGradingRun } from '@/lib/server/assignment-ai-grading-runs'
import { assertTeacherOwnsAssignment } from '@/lib/server/repo-review'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

export const POST = withErrorHandler('PostTeacherAssignmentAutoGradeRunTick', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: assignmentId, runId } = await context.params

  await assertTeacherOwnsAssignment(user.id, assignmentId)
  const result = await tickAssignmentAiGradingRun({ assignmentId, runId })

  return NextResponse.json({
    run: result.run,
    claimed: result.claimed,
  })
})

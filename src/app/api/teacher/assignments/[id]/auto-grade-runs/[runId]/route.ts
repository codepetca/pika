import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { getAssignmentAiGradingRunSummary } from '@/lib/server/assignment-ai-grading-runs'
import { assertTeacherOwnsAssignment } from '@/lib/server/repo-review'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetTeacherAssignmentAutoGradeRun', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: assignmentId, runId } = await context.params

  await assertTeacherOwnsAssignment(user.id, assignmentId)
  const run = await getAssignmentAiGradingRunSummary({ assignmentId, runId })

  if (!run) {
    return NextResponse.json({ error: 'Assignment AI grading run not found' }, { status: 404 })
  }

  return NextResponse.json({ run })
})

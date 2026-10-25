import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { repoLightRunRouteParamsSchema } from '@/lib/validations/repolight'
import { getAssignmentRepoLightReport } from '@/lib/server/assignment-repolight-runs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30
export const GET = withErrorHandler('ReadTeacherRepoLightReport', async (request, context) => {
  const actor = await requireRole('teacher')
  const params = repoLightRunRouteParamsSchema.parse(await context.params)
  const target = { assignmentId: params.id, studentId: params.studentId }
  return NextResponse.json(await getAssignmentRepoLightReport(actor.id, target, params.runId), { headers: { 'Cache-Control': 'no-store' } })
})

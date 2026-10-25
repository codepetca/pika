import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { repoLightRunRouteParamsSchema, advanceRepoLightRequestSchema } from '@/lib/validations/repolight'
import { advanceAssignmentRepoLightRun } from '@/lib/server/assignment-repolight-runs'
import { loadAssignmentRepoLightSource, readRepoLightRequestJson } from '@/lib/server/assignment-repolight-runs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30
export const POST = withErrorHandler('AdvanceTeacherRepoLightRun', async (request, context) => {
  const actor = await requireRole('teacher')
  const params = repoLightRunRouteParamsSchema.parse(await context.params)
  const target = { assignmentId: params.id, studentId: params.studentId }
  await loadAssignmentRepoLightSource(actor.id, target)
  advanceRepoLightRequestSchema.parse(await readRepoLightRequestJson(request))
  return NextResponse.json({ run: await advanceAssignmentRepoLightRun(actor.id, target, params.runId) }, { headers: { 'Cache-Control': 'no-store' } })
})

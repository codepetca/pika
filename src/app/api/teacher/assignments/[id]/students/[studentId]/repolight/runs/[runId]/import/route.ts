import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { repoLightRunRouteParamsSchema, importRepoLightRequestSchema } from '@/lib/validations/repolight'
import { importAssignmentRepoLightFeedback } from '@/lib/server/assignment-repolight-import'
import { loadAssignmentRepoLightSource, readRepoLightRequestJson } from '@/lib/server/assignment-repolight-runs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30
export const POST = withErrorHandler('ImportTeacherRepoLightFeedback', async (request, context) => {
  const actor = await requireRole('teacher')
  const params = repoLightRunRouteParamsSchema.parse(await context.params)
  const target = { assignmentId: params.id, studentId: params.studentId }
  await loadAssignmentRepoLightSource(actor.id, target)
  const input = importRepoLightRequestSchema.parse(await readRepoLightRequestJson(request))
  return NextResponse.json(await importAssignmentRepoLightFeedback(actor.id, target, params.runId, input), { headers: { 'Cache-Control': 'no-store' } })
})

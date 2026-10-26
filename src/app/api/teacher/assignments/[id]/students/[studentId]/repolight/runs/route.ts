import { NextResponse } from 'next/server'
import { requireRepoLightActor } from '@/lib/server/repolight-access'
import { withErrorHandler } from '@/lib/api-handler'
import { repoLightRouteParamsSchema, beginRepoLightRequestSchema } from '@/lib/validations/repolight'
import { getAssignmentRepoLightContext, beginAssignmentRepoLightRun, loadAssignmentRepoLightSource, readRepoLightRequestJson } from '@/lib/server/assignment-repolight-runs'
export const dynamic = 'force-dynamic'
export const GET = withErrorHandler('GetTeacherRepoLightContext', async (_request, context) => {
  const actor = await requireRepoLightActor()
  const params = repoLightRouteParamsSchema.parse(await context.params)
  return NextResponse.json(await getAssignmentRepoLightContext(actor.id, { assignmentId: params.id, studentId: params.studentId }), { headers: { 'Cache-Control': 'no-store' } })
})
export const POST = withErrorHandler('BeginTeacherRepoLightRun', async (request, context) => {
  const actor = await requireRepoLightActor()
  const params = repoLightRouteParamsSchema.parse(await context.params)
  const target = { assignmentId: params.id, studentId: params.studentId }
  await loadAssignmentRepoLightSource(actor.id, target)
  const input = beginRepoLightRequestSchema.parse(await readRepoLightRequestJson(request))
  return NextResponse.json({ run: await beginAssignmentRepoLightRun(actor.id, target, input) }, { status: 202, headers: { 'Cache-Control': 'no-store' } })
})

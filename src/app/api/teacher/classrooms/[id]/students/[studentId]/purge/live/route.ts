import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { getRepoLightRemovedContext, reserveRepoLightRemovedCleanup, advanceRepoLightRemovedCleanup } from '@/lib/server/repolight-removed-student-cleanup'
import { readRepoLightRequestJson } from '@/lib/server/assignment-repolight-runs'
import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { requireAuth, requireRole } from '@/lib/auth'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { getLiveStudentCleanupTarget, isLiveStudentCleanupEnabled, isManualRepoLightCleanupEnabled, readLiveStudentCleanup } from '@/lib/server/live-student-cleanup'
import { liveStudentCleanupParamsSchema, liveStudentCleanupQuerySchema, liveStudentCleanupRequestSchema } from '@/lib/validations/live-student-cleanup'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60
const headers = { 'Cache-Control': 'no-store' }

export const GET = withErrorHandler('GetLiveStudentCleanup', async (request, context) => {
  const candidate = isClassroomExperienceAdmissionConfigured() ? await requireAuth() : null
  const contextual = candidate !== null && resolveClassroomExperienceAdmission(candidate).status === 'admitted'
  const user = contextual && candidate ? candidate : await requireRole('teacher')
  const params = liveStudentCleanupParamsSchema.parse(await context.params)
  const canonical = (value: string) => contextual ? value.toLowerCase() : value
  const id = canonical(params.id)
  const studentId = canonical(params.studentId)
  const query = Object.fromEntries(new URL(request.url).searchParams)
  const requestedScope = query.scope === undefined ? undefined : z.literal('repolight_only').parse(query.scope)
  delete query.scope
  if (!Object.keys(query).length) {
    return NextResponse.json(await getLiveStudentCleanupTarget(canonical(user.id), id, studentId, ...(requestedScope ? [requestedScope] as const : [])), { headers })
  }
  const input = liveStudentCleanupQuerySchema.parse(query)
  const operation = await readLiveStudentCleanup({ teacherId: canonical(user.id), classroomId: id, studentId,
    operationId: canonical(input.operation_id), generationId: canonical(input.generation_id) }, ...(requestedScope ? [requestedScope] as const : []))
  return NextResponse.json({ operation, enabled: operation.scope === 'repolight_only' ? isManualRepoLightCleanupEnabled() : isLiveStudentCleanupEnabled() }, { headers })
})

export const POST = withErrorHandler('PostLiveStudentCleanup', async (request, context) => {
  const candidate = isClassroomExperienceAdmissionConfigured() ? await requireAuth() : null
  const contextual = candidate !== null && resolveClassroomExperienceAdmission(candidate).status === 'admitted'
  const user = contextual && candidate ? candidate : await requireRole('teacher')
  const params = liveStudentCleanupParamsSchema.parse(await context.params)
  const teacherId = user.id.toLowerCase(), classroomId = params.id.toLowerCase(), studentId = params.studentId.toLowerCase()
  // Read-only owner/retained-generation authorization precedes body parsing.
  const current = await getRepoLightRemovedContext({ teacherId, classroomId, studentId })
  const input = liveStudentCleanupRequestSchema.parse(await readRepoLightRequestJson(request))
  if (input.generation_id.toLowerCase() !== current.generation_id)
    throw new ApiError(409, 'The retained membership or cleanup scope changed')
  const scope = { teacherId, classroomId, studentId, generationId: current.generation_id, operationId: input.operation_id.toLowerCase() }
  if (input.scope === 'repolight_only') {
    if (input.confirmation !== 'REMOVE REPOSITORY REPORTS') throw new ApiError(400, 'Confirm removal of repository reports')
    if (!isManualRepoLightCleanupEnabled()) throw new ApiError(404, 'Repository report cleanup is paused')
    const operation = input.action === 'reserve' ? await reserveRepoLightRemovedCleanup(scope) : await advanceRepoLightRemovedCleanup(scope)
    return NextResponse.json({ operation, enabled: true }, { headers })
  }
  return NextResponse.json({ error: 'Teacher-directed classroom purge is not available' }, { status: 404, headers })
})

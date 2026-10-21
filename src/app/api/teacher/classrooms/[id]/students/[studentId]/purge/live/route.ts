import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { requireAuth, requireRole } from '@/lib/auth'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { getLiveStudentCleanupTarget, isLiveStudentCleanupEnabled, readLiveStudentCleanup } from '@/lib/server/live-student-cleanup'
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
  if (!Object.keys(query).length) {
    return NextResponse.json(await getLiveStudentCleanupTarget(canonical(user.id), id, studentId), { headers })
  }
  const input = liveStudentCleanupQuerySchema.parse(query)
  const operation = await readLiveStudentCleanup({ teacherId: canonical(user.id), classroomId: id, studentId,
    operationId: canonical(input.operation_id), generationId: canonical(input.generation_id) })
  return NextResponse.json({ operation, enabled: isLiveStudentCleanupEnabled() }, { headers })
})

export const POST = withErrorHandler('PostLiveStudentCleanup', async (request, context) => {
  await requireRole('teacher')
  liveStudentCleanupParamsSchema.parse(await context.params)
  liveStudentCleanupRequestSchema.parse(await request.json())
  return NextResponse.json({ error: 'Teacher-directed cleanup is no longer available' }, { status: 404, headers })
})

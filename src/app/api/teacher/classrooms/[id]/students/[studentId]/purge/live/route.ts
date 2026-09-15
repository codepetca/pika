import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { getLiveStudentCleanupTarget, isLiveStudentCleanupEnabled, readLiveStudentCleanup } from '@/lib/server/live-student-cleanup'
import { liveStudentCleanupParamsSchema, liveStudentCleanupQuerySchema, liveStudentCleanupRequestSchema } from '@/lib/validations/live-student-cleanup'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60
const headers = { 'Cache-Control': 'no-store' }

export const GET = withErrorHandler('GetLiveStudentCleanup', async (request, context) => {
  const user = await requireRole('teacher')
  const { id, studentId } = liveStudentCleanupParamsSchema.parse(await context.params)
  const query = Object.fromEntries(new URL(request.url).searchParams)
  if (!Object.keys(query).length) {
    return NextResponse.json(await getLiveStudentCleanupTarget(user.id, id, studentId), { headers })
  }
  const input = liveStudentCleanupQuerySchema.parse(query)
  const operation = await readLiveStudentCleanup({ teacherId: user.id, classroomId: id, studentId,
    operationId: input.operation_id, generationId: input.generation_id })
  return NextResponse.json({ operation, enabled: isLiveStudentCleanupEnabled() }, { headers })
})

export const POST = withErrorHandler('PostLiveStudentCleanup', async (request, context) => {
  await requireRole('teacher')
  liveStudentCleanupParamsSchema.parse(await context.params)
  liveStudentCleanupRequestSchema.parse(await request.json())
  return NextResponse.json({ error: 'Teacher-directed cleanup is no longer available' }, { status: 404, headers })
})

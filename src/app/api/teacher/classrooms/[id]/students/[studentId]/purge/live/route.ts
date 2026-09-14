import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { getLiveStudentCleanupTarget, liveStudentCleanup, readLiveStudentCleanup, requireLiveStudentCleanupEnabled } from '@/lib/server/live-student-cleanup'
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
    requireLiveStudentCleanupEnabled()
    return NextResponse.json(await getLiveStudentCleanupTarget(user.id, id, studentId), { headers })
  }
  const input = liveStudentCleanupQuerySchema.parse(query)
  const operation = await readLiveStudentCleanup({ teacherId: user.id, classroomId: id, studentId,
    operationId: input.operation_id, generationId: input.generation_id })
  return NextResponse.json({ operation }, { headers })
})

export const POST = withErrorHandler('PostLiveStudentCleanup', async (request, context) => {
  const user = await requireRole('teacher')
  requireLiveStudentCleanupEnabled()
  const { id, studentId } = liveStudentCleanupParamsSchema.parse(await context.params)
  const input = liveStudentCleanupRequestSchema.parse(await request.json())
  const operation = await liveStudentCleanup()[input.action]({ teacherId: user.id, classroomId: id, studentId,
    operationId: input.operation_id, generationId: input.generation_id })
  return NextResponse.json({ operation }, { status: operation.cleanup_completed ? 200 : 202, headers })
})

import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { getAttendanceDecommission, tickAttendanceDecommission } from '@/lib/server/bara-attendance-decommission'
import { authorizeSharedClassroomArchiveActor } from '@/lib/server/contextual-classroom-archive-recovery'
import { runContextualAttendanceDecommission } from '@/lib/server/contextual-attendance-decommission'
import { attendanceDecommissionParamsSchema } from '@/lib/validations/attendance-decommission'

export const maxDuration = 60
export const GET = withErrorHandler('GetAttendanceDecommission', async (_request, context) => {
  const access = await authorizeSharedClassroomArchiveActor()
  const user = access.mode === 'shared' ? access.user : await requireRole('teacher')
  const params = attendanceDecommissionParamsSchema.parse(await context.params)
  const run = () => getAttendanceDecommission({ teacherId: user.id, classroomId: params.id, operationId: params.operationId })
  const operation = access.mode === 'shared'
    ? await runContextualAttendanceDecommission(params.operationId, run) : await run()
  return NextResponse.json({ operation }, { headers: { 'Cache-Control': 'private, no-store' } })
})
export const POST = withErrorHandler('TickAttendanceDecommission', async (_request, context) => {
  const access = await authorizeSharedClassroomArchiveActor()
  const user = access.mode === 'shared' ? access.user : await requireRole('teacher')
  const params = attendanceDecommissionParamsSchema.parse(await context.params)
  const run = () => tickAttendanceDecommission({ teacherId: user.id, classroomId: params.id, operationId: params.operationId })
  const operation = access.mode === 'shared'
    ? await runContextualAttendanceDecommission(params.operationId, run) : await run()
  return NextResponse.json({ operation }, { status: operation.attendance_removed ? 200 : 202,
    headers: { 'Cache-Control': 'private, no-store' } })
})

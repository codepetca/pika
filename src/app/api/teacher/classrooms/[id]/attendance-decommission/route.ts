import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { beginAttendanceDecommission } from '@/lib/server/bara-attendance-decommission'
import { authorizeSharedClassroomArchiveActor } from '@/lib/server/contextual-classroom-archive-recovery'
import { runContextualAttendanceDecommission } from '@/lib/server/contextual-attendance-decommission'
import { attendanceDecommissionStartSchema, attendanceDecommissionClassroomSchema } from '@/lib/validations/attendance-decommission'

export const POST = withErrorHandler('BeginAttendanceDecommission', async (request, context) => {
  const access = await authorizeSharedClassroomArchiveActor()
  const user = access.mode === 'shared' ? access.user : await requireRole('teacher')
  const { id } = attendanceDecommissionClassroomSchema.parse(await context.params)
  const body = attendanceDecommissionStartSchema.parse(await request.json())
  const run = () => beginAttendanceDecommission({ teacherId: user.id, classroomId: id,
    operationId: body.operation_id, confirmation: body.confirmation })
  const operation = access.mode === 'shared'
    ? await runContextualAttendanceDecommission(body.operation_id, run) : await run()
  return NextResponse.json({ operation }, { status: 202, headers: { 'Cache-Control': 'private, no-store' } })
})

import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { beginAttendanceDecommission } from '@/lib/server/bara-attendance-decommission'
import { attendanceDecommissionStartSchema, attendanceDecommissionClassroomSchema } from '@/lib/validations/attendance-decommission'

export const POST = withErrorHandler('BeginAttendanceDecommission', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = attendanceDecommissionClassroomSchema.parse(await context.params)
  const body = attendanceDecommissionStartSchema.parse(await request.json())
  const operation = await beginAttendanceDecommission({ teacherId: user.id, classroomId: id,
    operationId: body.operation_id, confirmation: body.confirmation })
  return NextResponse.json({ operation }, { status: 202, headers: { 'Cache-Control': 'private, no-store' } })
})

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import {
  getActiveClassroomPurgeStatus,
  getClassroomPurgeImpact,
  startClassroomPurge,
} from '@/lib/server/classroom-purge'
import { classroomPurgeStartRequestSchema } from '@/lib/validations/classroom-purge'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

const classroomIdSchema = z.string().uuid()

export const GET = withErrorHandler(
  'GetTeacherClassroomPurgeImpact',
  async (_request, context) => {
    const user = await requireRole('teacher')
    const { id } = await context.params
    const classroomId = classroomIdSchema.parse(id)
    const [impact, operation] = await Promise.all([
      getClassroomPurgeImpact(user.id, classroomId),
      getActiveClassroomPurgeStatus(user.id, classroomId),
    ])
    return NextResponse.json({ impact, operation })
  },
)

export const POST = withErrorHandler(
  'PostTeacherClassroomPurge',
  async (request, context) => {
    const user = await requireRole('teacher')
    const { id } = await context.params
    const input = classroomPurgeStartRequestSchema.parse(await request.json())
    const operation = await startClassroomPurge({
      teacherId: user.id,
      classroomId: classroomIdSchema.parse(id),
      operationId: input.operation_id,
      confirmation: input.confirmation,
    })
    return NextResponse.json({ operation }, {
      status: operation.status === 'completed' ? 200 : 202,
    })
  },
)

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { assertStudentPurgeOperationTarget, getStudentPurgeStatus } from '@/lib/server/student-purge'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const uuidSchema = z.string().uuid()

export const GET = withErrorHandler('GetTeacherStudentPurgeStatus', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id, studentId, operationId } = await context.params
  await assertStudentPurgeOperationTarget(
    user.id,
    uuidSchema.parse(operationId),
    uuidSchema.parse(id),
    uuidSchema.parse(studentId),
  )
  const operation = await getStudentPurgeStatus(user.id, uuidSchema.parse(operationId))
  if (operation.classroom_id !== uuidSchema.parse(id)) {
    return NextResponse.json({ error: 'Student data deletion not found' }, { status: 404 })
  }
  return NextResponse.json({ operation })
})

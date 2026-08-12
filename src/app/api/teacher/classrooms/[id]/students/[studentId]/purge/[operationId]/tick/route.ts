import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { advanceStudentPurge, assertStudentPurgeOperationTarget } from '@/lib/server/student-purge'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60
const uuidSchema = z.string().uuid()
const emptyRequestSchema = z.object({}).strict()

export const POST = withErrorHandler('TickTeacherStudentPurge', async (request, context) => {
  const user = await requireRole('teacher')
  const { id, studentId, operationId } = await context.params
  const text = await request.text()
  if (text.trim()) {
    try {
      emptyRequestSchema.parse(JSON.parse(text))
    } catch (error) {
      if (error instanceof z.ZodError) throw error
      throw new ApiError(400, 'Request body must be valid JSON')
    }
  }
  const parsedOperationId = uuidSchema.parse(operationId)
  const classroomId = uuidSchema.parse(id)
  await assertStudentPurgeOperationTarget(
    user.id,
    parsedOperationId,
    classroomId,
    uuidSchema.parse(studentId),
  )
  const result = await advanceStudentPurge(user.id, parsedOperationId)
  return NextResponse.json(result, { status: result.operation.status === 'completed' ? 200 : 202 })
})

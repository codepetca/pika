import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import {
  advanceClassroomPurge,
  getClassroomPurgeStatus,
} from '@/lib/server/classroom-purge'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

const uuidSchema = z.string().uuid()
const emptyRequestSchema = z.object({}).strict()

export const POST = withErrorHandler(
  'TickTeacherClassroomPurge',
  async (request, context) => {
    const user = await requireRole('teacher')
    const { id, operationId } = await context.params
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
    const parsedClassroomId = uuidSchema.parse(id)
    const existing = await getClassroomPurgeStatus(user.id, parsedOperationId)
    if (existing.classroom_id !== parsedClassroomId) {
      return NextResponse.json({ error: 'Permanent deletion not found' }, { status: 404 })
    }
    const { operation, advanced } = await advanceClassroomPurge(user.id, parsedOperationId)
    return NextResponse.json(
      { operation, advanced },
      { status: operation.status === 'completed' ? 200 : 202 },
    )
  },
)

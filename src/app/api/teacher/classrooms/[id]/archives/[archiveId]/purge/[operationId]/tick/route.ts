import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import {
  advanceColdClassroomPurge,
  getColdClassroomPurgeStatus,
} from '@/lib/server/cold-classroom-purge'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

const uuidSchema = z.string().uuid()
const emptyRequestSchema = z.object({}).strict()

export const POST = withErrorHandler(
  'TickTeacherColdClassroomPurge',
  async (request, context) => {
    const user = await requireRole('teacher')
    const { id, archiveId, operationId } = await context.params
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
    await getColdClassroomPurgeStatus(
      user.id,
      uuidSchema.parse(id),
      uuidSchema.parse(archiveId),
      parsedOperationId,
    )
    const { operation, advanced } = await advanceColdClassroomPurge(
      user.id,
      parsedOperationId,
    )
    return NextResponse.json(
      { operation, advanced },
      { status: operation.status === 'completed' ? 200 : 202 },
    )
  },
)

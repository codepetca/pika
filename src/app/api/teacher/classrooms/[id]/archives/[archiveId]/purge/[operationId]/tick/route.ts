import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { authorizeSharedClassroomArchiveActor } from '@/lib/server/contextual-classroom-archive-recovery'
import { advanceContextualClassroomPurge } from '@/lib/server/contextual-classroom-purge'
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
    const actor = await authorizeSharedClassroomArchiveActor()
    const user = actor.mode === 'shared' ? actor.user : await requireRole('teacher')
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
    if (actor.mode === 'shared') {
      const result = await advanceContextualClassroomPurge({ actorId: user.id, classroomId: uuidSchema.parse(id), archiveId: uuidSchema.parse(archiveId) }, parsedOperationId)
      return NextResponse.json(result, { status: result.operation.status === 'completed' ? 200 : 202 })
    }
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

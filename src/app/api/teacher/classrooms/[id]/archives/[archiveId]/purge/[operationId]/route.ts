import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { authorizeSharedClassroomArchiveActor } from '@/lib/server/contextual-classroom-archive-recovery'
import { getContextualClassroomPurgeStatus } from '@/lib/server/contextual-classroom-purge'
import { getColdClassroomPurgeStatus } from '@/lib/server/cold-classroom-purge'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const uuidSchema = z.string().uuid()

export const GET = withErrorHandler(
  'GetTeacherColdClassroomPurgeStatus',
  async (_request, context) => {
    const actor = await authorizeSharedClassroomArchiveActor()
    if (actor.mode === 'shared') {
      const { id, archiveId, operationId } = await context.params
      const operation = await getContextualClassroomPurgeStatus({ actorId: actor.user.id, classroomId: uuidSchema.parse(id), archiveId: uuidSchema.parse(archiveId) }, uuidSchema.parse(operationId))
      return NextResponse.json({ operation })
    }
    const user = await requireRole('teacher')
    const { id, archiveId, operationId } = await context.params
    const operation = await getColdClassroomPurgeStatus(
      user.id,
      uuidSchema.parse(id),
      uuidSchema.parse(archiveId),
      uuidSchema.parse(operationId),
    )
    return NextResponse.json({ operation })
  },
)

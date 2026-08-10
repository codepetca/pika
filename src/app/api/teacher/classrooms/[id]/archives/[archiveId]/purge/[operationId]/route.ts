import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { getColdClassroomPurgeStatus } from '@/lib/server/cold-classroom-purge'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const uuidSchema = z.string().uuid()

export const GET = withErrorHandler(
  'GetTeacherColdClassroomPurgeStatus',
  async (_request, context) => {
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

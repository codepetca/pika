import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { getClassroomPurgeStatus } from '@/lib/server/classroom-purge'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const uuidSchema = z.string().uuid()

export const GET = withErrorHandler(
  'GetTeacherClassroomPurgeStatus',
  async (_request, context) => {
    const user = await requireRole('teacher')
    const { id, operationId } = await context.params
    const operation = await getClassroomPurgeStatus(
      user.id,
      uuidSchema.parse(operationId),
    )
    if (operation.classroom_id !== uuidSchema.parse(id)) {
      return NextResponse.json({ error: 'Permanent deletion not found' }, { status: 404 })
    }
    return NextResponse.json({ operation })
  },
)

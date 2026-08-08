import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { getCourseBlueprintPurgeStatus } from '@/lib/server/course-blueprint-purge'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const uuidSchema = z.string().uuid()

export const GET = withErrorHandler(
  'GetTeacherCourseBlueprintPurgeStatus',
  async (_request, context) => {
    const user = await requireRole('teacher')
    const { id, operationId } = await context.params
    const operation = await getCourseBlueprintPurgeStatus(
      user.id,
      uuidSchema.parse(operationId),
    )
    if (operation.course_blueprint_id !== uuidSchema.parse(id)) {
      return NextResponse.json({ error: 'Permanent deletion not found' }, { status: 404 })
    }
    return NextResponse.json({ operation })
  },
)

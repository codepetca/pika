import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import {
  getActiveCourseBlueprintPurgeStatus,
  getCourseBlueprintPurgeImpact,
  getCourseBlueprintPurgeImpactForOperation,
  startCourseBlueprintPurge,
} from '@/lib/server/course-blueprint-purge'
import { courseBlueprintPurgeStartRequestSchema } from '@/lib/validations/course-blueprint-purge'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

const uuidSchema = z.string().uuid()

export const GET = withErrorHandler(
  'GetTeacherCourseBlueprintPurgeImpact',
  async (_request, context) => {
    const user = await requireRole('teacher')
    const { id } = await context.params
    const courseBlueprintId = uuidSchema.parse(id)
    const operation = await getActiveCourseBlueprintPurgeStatus(
      user.id,
      courseBlueprintId,
    )
    const impact = operation
      ? await getCourseBlueprintPurgeImpactForOperation(
          user.id,
          courseBlueprintId,
          operation.operation_id,
        )
      : await getCourseBlueprintPurgeImpact(user.id, courseBlueprintId)
    return NextResponse.json({ impact, operation })
  },
)

export const POST = withErrorHandler(
  'PostTeacherCourseBlueprintPurge',
  async (request, context) => {
    const user = await requireRole('teacher')
    const { id } = await context.params
    const input = courseBlueprintPurgeStartRequestSchema.parse(await request.json())
    const operation = await startCourseBlueprintPurge({
      teacherId: user.id,
      courseBlueprintId: uuidSchema.parse(id),
      operationId: input.operation_id,
      confirmation: input.confirmation,
      expectedSourceRevision: input.expected_source_revision,
      expectedInventorySha256: input.expected_inventory_sha256,
    })
    return NextResponse.json(
      { operation },
      { status: operation.status === 'completed' ? 200 : 202 },
    )
  },
)

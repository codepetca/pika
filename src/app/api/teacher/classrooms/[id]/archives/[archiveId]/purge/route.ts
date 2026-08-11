import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import {
  getActiveColdClassroomPurgeStatus,
  getColdClassroomPurgeImpact,
  startColdClassroomPurge,
} from '@/lib/server/cold-classroom-purge'
import { coldClassroomPurgeStartRequestSchema } from '@/lib/validations/cold-classroom-purge'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

const uuidSchema = z.string().uuid()

export const GET = withErrorHandler(
  'GetTeacherColdClassroomPurgeImpact',
  async (_request, context) => {
    const user = await requireRole('teacher')
    const { id, archiveId } = await context.params
    const classroomId = uuidSchema.parse(id)
    const parsedArchiveId = uuidSchema.parse(archiveId)
    const [impact, operation] = await Promise.all([
      getColdClassroomPurgeImpact(user.id, classroomId, parsedArchiveId),
      getActiveColdClassroomPurgeStatus(user.id, classroomId, parsedArchiveId),
    ])
    return NextResponse.json({ impact, operation })
  },
)
export const POST = withErrorHandler(
  'PostTeacherColdClassroomPurge',
  async (request, context) => {
    const user = await requireRole('teacher')
    const { id, archiveId } = await context.params
    const input = coldClassroomPurgeStartRequestSchema.parse(await request.json())
    const operation = await startColdClassroomPurge({
      teacherId: user.id,
      classroomId: uuidSchema.parse(id),
      archiveId: uuidSchema.parse(archiveId),
      operationId: input.operation_id,
      confirmation: input.confirmation,
      expectedSourceRevision: input.expected_source_revision,
      expectedStorageInventorySha256: input.expected_storage_inventory_sha256,
      expectedColdResourceInventorySha256:
        input.expected_cold_resource_inventory_sha256,
    })
    return NextResponse.json(
      { operation },
      { status: operation.status === 'completed' ? 200 : 202 },
    )
  },
)

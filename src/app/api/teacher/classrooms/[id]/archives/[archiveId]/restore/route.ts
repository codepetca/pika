import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import {
  isClassroomArchiveRestoreAllowed,
  resolveClassroomArchiveRestoreDatabaseBudget,
  resolveClassroomArchiveRestoreOperationId,
  restoreClassroomArchive,
} from '@/lib/server/classroom-archive-restore-operations'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

const uuidSchema = z.string().uuid()
const requestSchema = z.object({}).strict()

async function parseRequest(request: NextRequest) {
  const text = await request.text()
  if (!text.trim()) return
  try {
    requestSchema.parse(JSON.parse(text))
  } catch (error) {
    if (error instanceof z.ZodError) throw error
    throw new ApiError(400, 'Request body must be valid JSON')
  }
}

export const POST = withErrorHandler('RestoreClassroomArchive', async (request, context) => {
  const user = await requireRole('teacher')
  const { id, archiveId } = await context.params
  const classroomId = uuidSchema.parse(id)
  const parsedArchiveId = uuidSchema.parse(archiveId)
  const operationId = resolveClassroomArchiveRestoreOperationId(
    request.headers.get('Idempotency-Key'),
  )
  await parseRequest(request)

  if (!isClassroomArchiveRestoreAllowed(user.id)) {
    return NextResponse.json({
      ok: false,
      status: 503,
      operation_id: operationId,
      error_code: 'classroom_archive_restore_not_enabled',
      error: 'Classroom archive restore is not enabled for this teacher',
      retryable: true,
    }, { status: 503 })
  }

  let databaseBudgetBytes: number
  try {
    databaseBudgetBytes = resolveClassroomArchiveRestoreDatabaseBudget()
  } catch {
    return NextResponse.json({
      ok: false,
      status: 503,
      operation_id: operationId,
      error_code: 'classroom_archive_restore_budget_unavailable',
      error: 'Classroom archive restore database budget is unavailable',
      retryable: true,
    }, { status: 503 })
  }

  const result = await restoreClassroomArchive({
    supabase: getServiceRoleClient(),
    operationId,
    archiveId: parsedArchiveId,
    teacherId: user.id,
    classroomId,
    databaseBudgetBytes,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  })
  return NextResponse.json(result, { status: result.status })
})

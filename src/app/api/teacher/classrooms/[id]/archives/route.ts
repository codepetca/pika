import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { classroomArchiveRetentionSchema } from '@/lib/contracts/classroom-artifacts'
import {
  exportClassroomArchive,
  isClassroomArchiveExportAllowed,
  resolveClassroomArchiveOperationId,
  resolveClassroomArchiveSourceCommit,
} from '@/lib/server/classroom-archive-operations'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

const requestSchema = z.object({
  retention: classroomArchiveRetentionSchema.optional(),
}).strict().superRefine((body, context) => {
  if (
    body.retention?.mode === 'scheduled' &&
    Date.parse(body.retention.delete_after) <= Date.now()
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Scheduled archive deletion must be in the future',
      path: ['retention', 'delete_after'],
    })
  }
})

async function parseRequest(request: NextRequest) {
  const text = await request.text()
  if (!text.trim()) return requestSchema.parse({})
  try {
    return requestSchema.parse(JSON.parse(text))
  } catch (error) {
    if (error instanceof z.ZodError) throw error
    throw new ApiError(400, 'Request body must be valid JSON')
  }
}

export const POST = withErrorHandler('ExportClassroomArchive', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const classroomId = z.string().uuid().parse(id)
  const operationId = resolveClassroomArchiveOperationId(request.headers.get('Idempotency-Key'))
  const body = await parseRequest(request)

  if (!isClassroomArchiveExportAllowed(user.id)) {
    return NextResponse.json({
      ok: false,
      status: 503,
      operation_id: operationId,
      error_code: 'classroom_archive_export_not_enabled',
      error: 'Classroom archive export is not enabled for this teacher',
      retryable: true,
    }, { status: 503 })
  }

  let sourceAppCommit: string
  try {
    sourceAppCommit = resolveClassroomArchiveSourceCommit()
  } catch {
    return NextResponse.json({
      ok: false,
      status: 503,
      operation_id: operationId,
      error_code: 'archive_source_version_unavailable',
      error: 'Archive export requires the deployed application commit',
      retryable: true,
    }, { status: 503 })
  }

  const result = await exportClassroomArchive({
    supabase: getServiceRoleClient(),
    operationId,
    teacherId: user.id,
    classroomId,
    retention: body.retention || { mode: 'teacher_managed', delete_after: null },
    sourceAppCommit,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  })
  return NextResponse.json(result, { status: result.status })
})

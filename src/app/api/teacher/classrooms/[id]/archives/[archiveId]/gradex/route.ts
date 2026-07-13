import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { GRADEX_EXTRACT_MAX_RETENTION_DAYS } from '@/lib/contracts/classroom-artifacts'
import {
  createClassroomGradexExtract,
  isClassroomGradexExtractAllowed,
  isClassroomGradexTriggerAllowed,
} from '@/lib/server/classroom-gradex-operations'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

const uuidSchema = z.string().uuid()
const maxRetentionMs = GRADEX_EXTRACT_MAX_RETENTION_DAYS * 24 * 60 * 60 * 1000
const requestSchema = z.object({
  delete_after: z.string().datetime({ offset: true }),
}).strict().superRefine((body, context) => {
  const now = Date.now()
  const deleteAfter = Date.parse(body.delete_after)
  if (deleteAfter <= now) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Gradex extract deletion must be in the future',
      path: ['delete_after'],
    })
  } else if (deleteAfter > now + maxRetentionMs) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Gradex extract retention cannot exceed ${GRADEX_EXTRACT_MAX_RETENTION_DAYS} days`,
      path: ['delete_after'],
    })
  }
})

async function parseRequest(request: NextRequest) {
  const text = await request.text()
  if (!text.trim()) throw new ApiError(400, 'Request body is required')
  try {
    return requestSchema.parse(JSON.parse(text))
  } catch (error) {
    if (error instanceof z.ZodError) throw error
    throw new ApiError(400, 'Request body must be valid JSON')
  }
}

export const POST = withErrorHandler('CreateClassroomGradexExtract', async (request, context) => {
  const user = await requireRole('teacher')
  const { id, archiveId } = await context.params
  const classroomId = uuidSchema.parse(id)
  const sourceArchiveId = uuidSchema.parse(archiveId)
  const rawOperationId = request.headers.get('Idempotency-Key')?.trim()
  if (!rawOperationId) throw new ApiError(400, 'Idempotency-Key header is required')
  const operationId = uuidSchema.parse(rawOperationId)
  const body = await parseRequest(request)

  if (!isClassroomGradexTriggerAllowed(sourceArchiveId)) {
    return NextResponse.json({
      ok: false,
      status: 503,
      operation_id: operationId,
      error_code: 'classroom_gradex_trigger_not_enabled',
      error: 'Gradex extract generation is not enabled for this source archive',
      retryable: true,
    }, { status: 503 })
  }

  if (!isClassroomGradexExtractAllowed(user.id)) {
    return NextResponse.json({
      ok: false,
      status: 503,
      operation_id: operationId,
      error_code: 'classroom_gradex_extract_not_enabled',
      error: 'Classroom Gradex extracts are not enabled for this teacher',
      retryable: true,
    }, { status: 503 })
  }

  const result = await createClassroomGradexExtract({
    supabase: getServiceRoleClient(),
    operationId,
    teacherId: user.id,
    classroomId,
    sourceArchiveId,
    deleteAfter: body.delete_after,
  })
  return NextResponse.json(result, { status: result.status })
})

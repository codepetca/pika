import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { createClassroomFromBlueprintSchema } from '@/lib/validations/course-blueprints'
import { createClassroomFromBlueprint } from '@/lib/server/course-blueprints'
import { resolveBlueprintOperationId } from '@/lib/server/course-blueprint-operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherCourseBlueprintInstantiate', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const body = createClassroomFromBlueprintSchema.parse(await request.json())
  const operationId = resolveBlueprintOperationId(request.headers.get('idempotency-key'))
  const result = await createClassroomFromBlueprint(user.id, {
    ...body,
    blueprintId: id,
  }, { operationId })
  if (!result.ok) {
    return NextResponse.json({
      error: result.error,
      operation_id: 'operation_id' in result ? result.operation_id : undefined,
      error_code: 'error_code' in result ? result.error_code : undefined,
      retryable: 'retryable' in result ? result.retryable : undefined,
    }, { status: result.status })
  }
  return NextResponse.json({
    classroom: result.classroom,
    lesson_mapping: result.lesson_mapping,
    operation_id: result.operation_id,
    replayed: result.replayed,
  }, { status: 201 })
})

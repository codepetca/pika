import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { createCourseBlueprintFromClassroomSchema } from '@/lib/validations/course-blueprints'
import { createCourseBlueprintFromClassroom } from '@/lib/server/course-blueprints'
import { resolveBlueprintOperationId } from '@/lib/server/course-blueprint-operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherClassroomBlueprint', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const body = createCourseBlueprintFromClassroomSchema.parse(await request.json())
  const operationId = resolveBlueprintOperationId(request.headers.get('idempotency-key'))
  const result = await createCourseBlueprintFromClassroom(user.id, id, body, { operationId })

  if (!result.ok) {
    return NextResponse.json({
      error: result.error,
      operation_id: 'operation_id' in result ? result.operation_id : undefined,
      error_code: 'error_code' in result ? result.error_code : undefined,
      retryable: 'retryable' in result ? result.retryable : undefined,
    }, { status: result.status })
  }

  return NextResponse.json({
    blueprint_id: result.blueprint.id,
    redirect_url: `/teacher/blueprints?blueprint=${encodeURIComponent(result.blueprint.id)}&fromClassroom=${encodeURIComponent(id)}`,
    operation_id: result.operation_id,
    replayed: result.replayed,
  }, { status: 201 })
})

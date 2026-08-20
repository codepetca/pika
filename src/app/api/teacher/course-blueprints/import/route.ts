import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import {
  importCourseBlueprintPlan,
} from '@/lib/server/course-blueprints'
import {
  planCourseBlueprintPackageRequest,
  readCourseBlueprintPackageBody,
} from '@/lib/course-blueprint-package-request'
import { resolveBlueprintOperationId } from '@/lib/server/course-blueprint-operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherCourseBlueprintImport', async (request) => {
  const user = await requireRole('teacher')
  const operationId = resolveBlueprintOperationId(request.headers.get('idempotency-key'))
  const body = await readCourseBlueprintPackageBody(request)
  const planned = planCourseBlueprintPackageRequest(
    body,
    request.headers.get('content-type'),
  )
  if (!planned.ok) {
    return NextResponse.json({
      error: 'Invalid course package',
      errors: planned.errors,
    }, { status: 400 })
  }
  const result = await importCourseBlueprintPlan(user.id, planned.plan, { operationId })

  if (!result.ok) {
    return NextResponse.json({
      error: result.error,
      errors: 'errors' in result ? result.errors : undefined,
      operation_id: 'operation_id' in result ? result.operation_id : undefined,
      error_code: 'error_code' in result ? result.error_code : undefined,
      retryable: 'retryable' in result ? result.retryable : undefined,
    }, { status: result.status })
  }
  return NextResponse.json({
    blueprint: result.blueprint,
    operation_id: result.operation_id,
    replayed: result.replayed,
  }, { status: 201 })
})

import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { COURSE_BLUEPRINT_PACKAGE_MAX_BYTES } from '@/lib/contracts/course-blueprint-package'
import {
  importCourseBlueprintArchive,
  importCourseBlueprintBundle,
} from '@/lib/server/course-blueprints'
import { resolveBlueprintOperationId } from '@/lib/server/course-blueprint-operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function readCoursePackageBody(request: Request): Promise<Uint8Array> {
  const contentLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > COURSE_BLUEPRINT_PACKAGE_MAX_BYTES) {
    throw new ApiError(413, 'Course package exceeds the 8 MiB limit')
  }
  if (!request.body) return new Uint8Array()

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > COURSE_BLUEPRINT_PACKAGE_MAX_BYTES) {
        await reader.cancel()
        throw new ApiError(413, 'Course package exceeds the 8 MiB limit')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

export const POST = withErrorHandler('PostTeacherCourseBlueprintImport', async (request) => {
  const user = await requireRole('teacher')
  const contentType = request.headers.get('content-type') || ''
  const operationId = resolveBlueprintOperationId(request.headers.get('idempotency-key'))
  const body = await readCoursePackageBody(request)
  let bundle: unknown
  if (contentType.includes('application/json')) {
    try {
      bundle = JSON.parse(new TextDecoder().decode(body))
    } catch (error) {
      if (error instanceof SyntaxError) throw new ApiError(400, 'Malformed JSON body')
      throw error
    }
  }
  const result = contentType.includes('application/json')
    ? await importCourseBlueprintBundle(user.id, bundle, { operationId })
    : await importCourseBlueprintArchive(user.id, body, { operationId })

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

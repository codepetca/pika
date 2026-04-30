import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import {
  importCourseBlueprintArchive,
  importCourseBlueprintBundle,
} from '@/lib/server/course-blueprints'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherCourseBlueprintImport', async (request) => {
  const user = await requireRole('teacher')
  const contentType = request.headers.get('content-type') || ''
  const result = contentType.includes('application/json')
    ? await importCourseBlueprintBundle(user.id, await request.json())
    : await importCourseBlueprintArchive(user.id, await request.arrayBuffer())

  if (!result.ok) {
    return NextResponse.json({ error: result.error, errors: 'errors' in result ? result.errors : undefined }, { status: result.status })
  }
  return NextResponse.json({ blueprint: result.blueprint }, { status: 201 })
})

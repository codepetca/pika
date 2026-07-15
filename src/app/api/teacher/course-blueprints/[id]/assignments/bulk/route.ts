import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { syncCourseBlueprintAssignments } from '@/lib/server/course-blueprints'
import { courseBlueprintAssignmentsBulkSchema } from '@/lib/validations/course-blueprints'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherCourseBlueprintAssignmentsBulk', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const body = courseBlueprintAssignmentsBulkSchema.parse(await request.json())

  const result = await syncCourseBlueprintAssignments(user.id, id, body.assignments)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ success: true })
})

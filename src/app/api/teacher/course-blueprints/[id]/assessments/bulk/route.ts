import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { syncCourseBlueprintAssessments } from '@/lib/server/course-blueprints'
import { courseBlueprintAssessmentsBulkSchema } from '@/lib/validations/course-blueprints'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherCourseBlueprintAssessmentsBulk', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const body = courseBlueprintAssessmentsBulkSchema.parse(await request.json())

  const result = await syncCourseBlueprintAssessments(user.id, id, body.assessments, {
    replaceTypes:
      body.assessmentType === 'test'
        ? [body.assessmentType]
        : undefined,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ success: true })
})

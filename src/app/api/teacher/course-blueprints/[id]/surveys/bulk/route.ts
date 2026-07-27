import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { syncCourseBlueprintSurveys } from '@/lib/server/course-blueprints'
import { courseBlueprintSurveysBulkSchema } from '@/lib/validations/course-blueprints'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler(
  'PostTeacherCourseBlueprintSurveysBulk',
  async (request, context) => {
    const user = await requireRole('teacher')
    const { id } = await context.params
    const body = courseBlueprintSurveysBulkSchema.parse(await request.json())
    const result = await syncCourseBlueprintSurveys(user.id, id, body.surveys)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ success: true })
  },
)

import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { syncCourseBlueprintLessonTemplates } from '@/lib/server/course-blueprints'
import { courseBlueprintLessonTemplatesBulkSchema } from '@/lib/validations/course-blueprints'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherCourseBlueprintLessonTemplatesBulk', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const body = courseBlueprintLessonTemplatesBulkSchema.parse(await request.json())

  const result = await syncCourseBlueprintLessonTemplates(user.id, id, body.lesson_templates)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ success: true })
})

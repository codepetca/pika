import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { syncCourseBlueprintLessonTemplates } from '@/lib/server/course-blueprints'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherCourseBlueprintLessonTemplatesBulk', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const body = await request.json()
  if (!Array.isArray(body.lesson_templates)) {
    return NextResponse.json({ error: 'lesson_templates array is required' }, { status: 400 })
  }

  const result = await syncCourseBlueprintLessonTemplates(user.id, id, body.lesson_templates)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ success: true })
})

import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { courseBlueprintAiApplySchema } from '@/lib/validations/teacher'
import {
  updateCourseBlueprint,
  getCourseBlueprintDetail,
  syncCourseBlueprintAssignments,
  syncCourseBlueprintAssessments,
  syncCourseBlueprintLessonTemplates,
} from '@/lib/server/course-blueprints'
import { markdownToCourseBlueprintAssignments } from '@/lib/course-blueprint-assignments'
import { markdownToCourseBlueprintAssessments } from '@/lib/course-blueprint-assessments-markdown'
import { markdownToCourseBlueprintLessonTemplates } from '@/lib/course-blueprint-lesson-templates'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherCourseBlueprintAiApply', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const { target, content } = courseBlueprintAiApplySchema.parse(await request.json())
  const detailResult = await getCourseBlueprintDetail(user.id, id)

  if (!detailResult.detail) {
    return NextResponse.json({ error: detailResult.error }, { status: detailResult.status || 500 })
  }

  if (target === 'overview' || target === 'outline' || target === 'resources') {
    const key =
      target === 'overview'
        ? 'overview_markdown'
        : target === 'outline'
          ? 'outline_markdown'
          : 'resources_markdown'
    const result = await updateCourseBlueprint(user.id, id, { [key]: content } as any)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ success: true })
  }

  if (target === 'assignments') {
    const parsed = markdownToCourseBlueprintAssignments(content, detailResult.detail.assignments)
    if (parsed.errors.length > 0) {
      return NextResponse.json({ errors: parsed.errors }, { status: 400 })
    }
    const result = await syncCourseBlueprintAssignments(user.id, id, parsed.assignments)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ success: true, warnings: parsed.warnings })
  }

  if (target === 'quizzes' || target === 'tests') {
    const parsed = markdownToCourseBlueprintAssessments(content, detailResult.detail.assessments as any, target === 'quizzes' ? 'quiz' : 'test')
    if (parsed.errors.length > 0) {
      return NextResponse.json({ errors: parsed.errors }, { status: 400 })
    }
    const result = await syncCourseBlueprintAssessments(user.id, id, parsed.assessments as any)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ success: true, warnings: parsed.warnings })
  }

  const parsed = markdownToCourseBlueprintLessonTemplates(content, detailResult.detail.lesson_templates)
  if (parsed.errors.length > 0) {
    return NextResponse.json({ errors: parsed.errors }, { status: 400 })
  }
  const result = await syncCourseBlueprintLessonTemplates(user.id, id, parsed.lesson_templates)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ success: true, warnings: parsed.warnings })
})

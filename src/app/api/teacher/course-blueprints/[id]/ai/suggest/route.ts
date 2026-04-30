import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { courseBlueprintAiSuggestSchema } from '@/lib/validations/teacher'
import { getCourseBlueprintDetail } from '@/lib/server/course-blueprints'
import { suggestCourseBlueprintDraft } from '@/lib/course-blueprint-copilot'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherCourseBlueprintAiSuggest', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const { target, prompt } = courseBlueprintAiSuggestSchema.parse(await request.json())
  const detailResult = await getCourseBlueprintDetail(user.id, id)

  if (!detailResult.detail) {
    return NextResponse.json({ error: detailResult.error }, { status: detailResult.status || 500 })
  }

  const suggestion = suggestCourseBlueprintDraft(detailResult.detail, target, prompt)
  return NextResponse.json({ suggestion })
})

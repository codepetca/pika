import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { courseBlueprintAiSuggestSchema } from '@/lib/validations/course-blueprints'
import { getCourseBlueprintDetail } from '@/lib/server/course-blueprints'
import { suggestCourseBlueprintDraft } from '@/lib/course-blueprint-copilot'
import { generateCourseBlueprintGuidedDraft } from '@/lib/server/course-blueprint-guided-drafting'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherCourseBlueprintAiSuggest', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const { target, prompt, unit_exception_id, trial_guidance } = courseBlueprintAiSuggestSchema.parse(await request.json())
  const detailResult = await getCourseBlueprintDetail(user.id, id)

  if (!detailResult.detail) {
    return NextResponse.json({ error: detailResult.error }, { status: detailResult.status || 500 })
  }

  if (target === 'assignments' || target === 'tests') {
    if (unit_exception_id && !(trial_guidance ?? detailResult.detail.authoring_guidance).unit_exceptions.some(
      (unit) => unit.id === unit_exception_id,
    )) {
      return NextResponse.json({ error: 'The selected unit guidance is no longer available' }, { status: 409 })
    }
    const suggestion = await generateCourseBlueprintGuidedDraft({
      detail: detailResult.detail,
      target,
      prompt,
      unitExceptionId: unit_exception_id,
      trialGuidance: trial_guidance,
    })
    return NextResponse.json({ suggestion })
  }
  const suggestion = suggestCourseBlueprintDraft(detailResult.detail, target, prompt)
  return NextResponse.json({ suggestion })
})

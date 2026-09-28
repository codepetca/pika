import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { classroomGuidedDraftSuggestSchema } from '@/lib/validations/classroom-guided-drafts'
import { getClassroomAuthoringGuidance } from '@/lib/server/classroom-authoring-guidance'
import { generateClassroomGuidedDraft } from '@/lib/server/course-blueprint-guided-drafting'
import { acquireCourseBlueprintDraftSlot } from '@/lib/server/course-blueprint-draft-admission'
import {
  createClassroomDraftProvenanceToken,
  hashClassroomDraftContent,
} from '@/lib/server/classroom-draft-provenance'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherClassroomAuthoringDraftSuggest', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const { target, prompt, unit_exception_id } = classroomGuidedDraftSuggestSchema.parse(await request.json())
  const result = await getClassroomAuthoringGuidance(user.id, id)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  if (!result.context) {
    return NextResponse.json({ error: 'This Classroom has no Blueprint Version guidance' }, { status: 409 })
  }
  if (unit_exception_id && !result.context.guidance.unit_exceptions.some((unit) => unit.id === unit_exception_id)) {
    return NextResponse.json({ error: 'The selected unit guidance is no longer available' }, { status: 409 })
  }

  const releaseDraftSlot = await acquireCourseBlueprintDraftSlot({ teacherId: user.id })
  try {
    const suggestion = await generateClassroomGuidedDraft({
      source: result.context,
      target,
      prompt,
      unitExceptionId: unit_exception_id,
    })
    const { trial, ...provenance } = suggestion.guidance
    const originalContentSha256 = hashClassroomDraftContent(suggestion.content)
    const draftId = crypto.randomUUID()
    return NextResponse.json({ suggestion: {
      ...suggestion,
      draft_id: draftId,
      original_content_sha256: originalContentSha256,
      draft_provenance_token: createClassroomDraftProvenanceToken({
        teacherId: user.id,
        classroomId: id,
        draftId,
        provenance,
        seedContentSha256: originalContentSha256,
        trial,
      }),
    } })
  } finally {
    await releaseDraftSlot()
  }
})

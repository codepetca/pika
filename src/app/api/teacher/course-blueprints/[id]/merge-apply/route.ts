import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { applyBlueprintMergeSchema } from '@/lib/validations/course-blueprints'
import { applyBlueprintMergeSuggestions } from '@/lib/server/course-sites'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherCourseBlueprintMergeApply', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const body = applyBlueprintMergeSchema.parse(await request.json())

  const result = await applyBlueprintMergeSuggestions(
    user.id,
    id,
    body.classroomId,
    body.areas,
    {
      expectedBlueprintRevision: body.expectedBlueprintRevision,
      expectedClassroomRevision: body.expectedClassroomRevision,
    }
  )
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ proposal: result.proposal }, { status: 201 })
})

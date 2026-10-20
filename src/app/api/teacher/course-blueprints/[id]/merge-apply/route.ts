import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { authorizeClassroomReuseActor } from '@/lib/server/contextual-classroom-reuse'
import { contextualClassroomReuseParamsSchema } from '@/lib/validations/contextual-classroom-reuse'
import { withErrorHandler } from '@/lib/api-handler'
import { applyBlueprintMergeSchema } from '@/lib/validations/course-blueprints'
import { applyBlueprintMergeSuggestions } from '@/lib/server/course-sites'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherCourseBlueprintMergeApply', async (request, context) => {
  const { user, contextual } = await authorizeClassroomReuseActor()
  const allowActiveLegacy = contextual && user.role === 'teacher'
  if (allowActiveLegacy) await requireRole('teacher')
  const params = await context.params
  const { id } = contextual ? contextualClassroomReuseParamsSchema.parse(params) : params
  const body = applyBlueprintMergeSchema.parse(await request.json())

  const result = await applyBlueprintMergeSuggestions(
    user.id,
    id,
    contextual ? body.classroomId.toLowerCase() : body.classroomId,
    body.areas,
    {
      expectedBlueprintRevision: body.expectedBlueprintRevision,
      expectedClassroomRevision: body.expectedClassroomRevision,
    },
    ...(contextual ? [{ archivedReuse: true, ...(allowActiveLegacy ? { allowActiveLegacy: true } : {}) }] : []),
  )
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ proposal: result.proposal }, { status: 201 })
})

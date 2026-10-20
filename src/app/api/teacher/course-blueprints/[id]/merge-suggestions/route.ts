import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { authorizeClassroomReuseActor } from '@/lib/server/contextual-classroom-reuse'
import { contextualClassroomReuseParamsSchema } from '@/lib/validations/contextual-classroom-reuse'
import { withErrorHandler } from '@/lib/api-handler'
import { blueprintMergeSuggestionQuerySchema } from '@/lib/validations/course-blueprints'
import { getBlueprintMergeSuggestionSet } from '@/lib/server/course-sites'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetTeacherCourseBlueprintMergeSuggestions', async (request, context) => {
  const { user, contextual } = await authorizeClassroomReuseActor()
  const allowActiveLegacy = contextual && user.role === 'teacher'
  if (allowActiveLegacy) await requireRole('teacher')
  const params = await context.params
  const { id } = contextual ? contextualClassroomReuseParamsSchema.parse(params) : params
  const { searchParams } = new URL(request.url)
  const query = blueprintMergeSuggestionQuerySchema.parse({
    classroomId: searchParams.get('classroomId'),
  })

  const result = await getBlueprintMergeSuggestionSet(user.id, id, contextual ? query.classroomId.toLowerCase() : query.classroomId,
    ...(contextual ? [{ archivedReuse: true, ...(allowActiveLegacy ? { allowActiveLegacy: true } : {}) }] : []))
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ suggestion_set: result.suggestionSet })
})

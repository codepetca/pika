import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { blueprintMergeSuggestionQuerySchema } from '@/lib/validations/teacher'
import { getBlueprintMergeSuggestionSet } from '@/lib/server/course-sites'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetTeacherCourseBlueprintMergeSuggestions', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const { searchParams } = new URL(request.url)
  const query = blueprintMergeSuggestionQuerySchema.parse({
    classroomId: searchParams.get('classroomId'),
  })

  const result = await getBlueprintMergeSuggestionSet(user.id, id, query.classroomId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ suggestion_set: result.suggestionSet })
})

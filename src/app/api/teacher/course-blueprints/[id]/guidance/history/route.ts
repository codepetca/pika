import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { getCourseBlueprintGuidanceHistory } from '@/lib/server/course-blueprint-guidance-history'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetTeacherBlueprintGuidanceHistory', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const result = await getCourseBlueprintGuidanceHistory(user.id, id)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ revisions: result.revisions })
})

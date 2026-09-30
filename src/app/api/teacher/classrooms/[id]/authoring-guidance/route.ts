import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { getClassroomAuthoringGuidance } from '@/lib/server/classroom-authoring-guidance'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetTeacherClassroomAuthoringGuidance', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const result = await getClassroomAuthoringGuidance(user.id, id)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ context: result.context })
})

import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { syncCourseBlueprintAssessments } from '@/lib/server/course-blueprints'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherCourseBlueprintAssessmentsBulk', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const body = await request.json()
  if (!Array.isArray(body.assessments)) {
    return NextResponse.json({ error: 'assessments array is required' }, { status: 400 })
  }

  const result = await syncCourseBlueprintAssessments(user.id, id, body.assessments)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ success: true })
})

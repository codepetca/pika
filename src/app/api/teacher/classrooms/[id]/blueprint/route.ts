import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { createCourseBlueprintFromClassroomSchema } from '@/lib/validations/teacher'
import { createCourseBlueprintFromClassroom } from '@/lib/server/course-blueprints'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherClassroomBlueprint', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const body = createCourseBlueprintFromClassroomSchema.parse(await request.json())
  const result = await createCourseBlueprintFromClassroom(user.id, id, body)

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({
    blueprint_id: result.blueprint.id,
    redirect_url: `/teacher/blueprints?blueprint=${encodeURIComponent(result.blueprint.id)}&fromClassroom=${encodeURIComponent(id)}`,
  }, { status: 201 })
})

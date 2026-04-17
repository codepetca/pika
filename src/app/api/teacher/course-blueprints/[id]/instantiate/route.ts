import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { createClassroomFromBlueprintSchema } from '@/lib/validations/teacher'
import { createClassroomFromBlueprint } from '@/lib/server/course-blueprints'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherCourseBlueprintInstantiate', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const body = createClassroomFromBlueprintSchema.parse(await request.json())
  const result = await createClassroomFromBlueprint(user.id, {
    ...body,
    blueprintId: id,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({
    classroom: result.classroom,
    lesson_mapping: result.lesson_mapping,
  }, { status: 201 })
})

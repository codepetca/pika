import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { updateCourseBlueprintSchema } from '@/lib/validations/teacher'
import {
  deleteCourseBlueprint,
  getCourseBlueprintDetail,
  updateCourseBlueprint,
} from '@/lib/server/course-blueprints'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetTeacherCourseBlueprint', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const result = await getCourseBlueprintDetail(user.id, id)
  if (!result.detail) {
    return NextResponse.json({ error: result.error }, { status: result.status || 500 })
  }
  return NextResponse.json({ blueprint: result.detail })
})

export const PATCH = withErrorHandler('PatchTeacherCourseBlueprint', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const updates = updateCourseBlueprintSchema.parse(await request.json())
  const result = await updateCourseBlueprint(user.id, id, updates as any)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ blueprint: result.blueprint })
})

export const DELETE = withErrorHandler('DeleteTeacherCourseBlueprint', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const result = await deleteCourseBlueprint(user.id, id)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ success: true })
})

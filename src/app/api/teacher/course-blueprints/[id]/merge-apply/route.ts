import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { applyBlueprintMergeSchema } from '@/lib/validations/teacher'
import { applyBlueprintMergeSuggestions } from '@/lib/server/course-sites'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const POST = withErrorHandler('PostTeacherCourseBlueprintMergeApply', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const body = applyBlueprintMergeSchema.parse(await request.json())

  const result = await applyBlueprintMergeSuggestions(user.id, id, body.classroomId, body.areas)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ success: true })
})

import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { classroomGuidanceAdoptionSchema } from '@/lib/validations/classroom-guidance-adoption'
import { adoptClassroomGuidance, previewClassroomGuidanceAdoption } from '@/lib/server/classroom-guidance-adoption'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('PreviewClassroomGuidanceAdoption', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const result = await previewClassroomGuidanceAdoption(user.id, id)
  return NextResponse.json(result.ok ? { preview: result.preview } : { error: result.error },
    { status: result.ok ? 200 : result.status })
})

export const POST = withErrorHandler('AdoptClassroomGuidance', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const input = classroomGuidanceAdoptionSchema.parse(await request.json())
  const result = await adoptClassroomGuidance(user.id, id, input)
  return NextResponse.json(result.ok ? { version: result.version } : { error: result.error },
    { status: result.ok ? 200 : result.status })
})

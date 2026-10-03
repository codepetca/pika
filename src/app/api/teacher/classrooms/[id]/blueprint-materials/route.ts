import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { classroomBlueprintMaterialsParamsSchema } from '@/lib/validations/classroom-blueprint-materials'
import { getClassroomBlueprintMaterials } from '@/lib/server/classroom-blueprint-materials'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetTeacherClassroomBlueprintMaterials', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id } = classroomBlueprintMaterialsParamsSchema.parse(await context.params)
  const result = await getClassroomBlueprintMaterials(user.id, id)
  return result.ok
    ? NextResponse.json({ materials: result.materials })
    : NextResponse.json({ error: result.error }, { status: result.status })
})

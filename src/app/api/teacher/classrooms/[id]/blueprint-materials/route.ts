import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { classroomBlueprintMaterialsParamsSchema } from '@/lib/validations/classroom-blueprint-materials'
import { getClassroomBlueprintMaterials } from '@/lib/server/classroom-blueprint-materials'
import { authorizeSharedMaterialReadActor } from '@/lib/server/contextual-material-read'
import { readContextualClassroomBlueprintMaterials } from '@/lib/server/contextual-classroom-blueprint-material-read'
import { contextualBlueprintMaterialReadParamsSchema } from '@/lib/validations/contextual-classroom-blueprint-material-read'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetTeacherClassroomBlueprintMaterials', async (_request, context) => {
  const sharedAccess = await authorizeSharedMaterialReadActor()
  if (sharedAccess.mode === 'shared') {
    const { id } = contextualBlueprintMaterialReadParamsSchema.parse(await context.params)
    const result = await readContextualClassroomBlueprintMaterials({
      supabase: getServiceRoleClient(), actorId: sharedAccess.user.id, classroomId: id,
    })
    return NextResponse.json(result)
  }
  const user = await requireRole('teacher')
  const { id } = classroomBlueprintMaterialsParamsSchema.parse(await context.params)
  const result = await getClassroomBlueprintMaterials(user.id, id)
  return result.ok
    ? NextResponse.json({ materials: result.materials })
    : NextResponse.json({ error: result.error }, { status: result.status })
})

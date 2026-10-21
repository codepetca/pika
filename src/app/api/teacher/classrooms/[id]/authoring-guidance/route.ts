import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { getClassroomAuthoringGuidance } from '@/lib/server/classroom-authoring-guidance'
import { authorizeSharedClassroomMetadataActor } from '@/lib/server/contextual-classroom-metadata'
import { readContextualClassroomAuthoringGuidance } from '@/lib/server/contextual-classroom-authoring-guidance-read'
import { contextualClassroomAuthoringGuidanceParamsSchema } from '@/lib/validations/contextual-classroom-authoring-guidance-read'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetTeacherClassroomAuthoringGuidance', async (_request, context) => {
  const admission = await authorizeSharedClassroomMetadataActor()
  if (admission.mode === 'shared') {
    const { id } = contextualClassroomAuthoringGuidanceParamsSchema.parse(await context.params)
    return NextResponse.json(await readContextualClassroomAuthoringGuidance({
      supabase: getServiceRoleClient(), actorId: admission.user.id, classroomId: id,
    }))
  }
  const user = await requireRole('teacher')
  const { id } = await context.params
  const result = await getClassroomAuthoringGuidance(user.id, id)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ context: result.context })
})

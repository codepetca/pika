import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { classroomGuidanceAdoptionSchema } from '@/lib/validations/classroom-guidance-adoption'
import { adoptClassroomGuidance, previewClassroomGuidanceAdoption } from '@/lib/server/classroom-guidance-adoption'
import { authorizeSharedClassroomMetadataActor } from '@/lib/server/contextual-classroom-metadata'
import { readContextualClassroomGuidancePreview } from '@/lib/server/contextual-classroom-guidance-preview'
import { contextualClassroomGuidancePreviewParamsSchema } from '@/lib/validations/contextual-classroom-guidance-preview'
import { adoptContextualClassroomGuidance } from '@/lib/server/contextual-classroom-guidance-adoption'
import { contextualClassroomGuidanceAdoptionParamsSchema, contextualClassroomGuidanceAdoptionInputSchema } from '@/lib/validations/contextual-classroom-guidance-adoption'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('PreviewClassroomGuidanceAdoption', async (_request, context) => {
  const admission = await authorizeSharedClassroomMetadataActor()
  if (admission.mode === 'shared') {
    const { id } = contextualClassroomGuidancePreviewParamsSchema.parse(await context.params)
    return NextResponse.json(await readContextualClassroomGuidancePreview({
      supabase: getServiceRoleClient(), actorId: admission.user.id, classroomId: id,
    }))
  }
  const user = await requireRole('teacher')
  const { id } = await context.params
  const result = await previewClassroomGuidanceAdoption(user.id, id)
  return NextResponse.json(result.ok ? { preview: result.preview } : { error: result.error },
    { status: result.ok ? 200 : result.status })
})

export const POST = withErrorHandler('AdoptClassroomGuidance', async (request, context) => {
  const admission = await authorizeSharedClassroomMetadataActor()
  if (admission.mode === 'shared') {
    const { id } = contextualClassroomGuidanceAdoptionParamsSchema.parse(await context.params)
    const input = contextualClassroomGuidanceAdoptionInputSchema.parse(await request.json())
    return NextResponse.json(await adoptContextualClassroomGuidance({
      supabase: getServiceRoleClient(), actorId: admission.user.id, classroomId: id, input,
    }))
  }
  const user = await requireRole('teacher')
  const { id } = await context.params
  const input = classroomGuidanceAdoptionSchema.parse(await request.json())
  const result = await adoptClassroomGuidance(user.id, id, input)
  return NextResponse.json(result.ok ? { version: result.version } : { error: result.error },
    { status: result.ok ? 200 : result.status })
})

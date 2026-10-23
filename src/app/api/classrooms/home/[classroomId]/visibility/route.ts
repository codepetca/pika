import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { authenticateContextualClassroomHome } from '@/lib/server/contextual-classroom-home'
import { resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { setClassroomHomeVisibility } from '@/lib/server/classroom-home-visibility'
import { classroomHomeVisibilitySchema } from '@/lib/validations/classroom-home-visibility'
import { getServiceRoleClient } from '@/lib/supabase'

const classroomHomeVisibilityParamsSchema = z.object({ classroomId: z.string().uuid() }).strict()

export const PATCH = withErrorHandler('SetClassroomHomeVisibility', async (
  request: NextRequest, context: { params: Promise<Record<string, string>> },
) => {
  const user = await authenticateContextualClassroomHome()
  if (resolveClassroomExperienceAdmission(user).status !== 'admitted') throw new ApiError(404, 'Not found')
  const { classroomId } = classroomHomeVisibilityParamsSchema.parse(await context.params)
  const input = classroomHomeVisibilitySchema.parse(await request.json())
  return NextResponse.json(await setClassroomHomeVisibility({
    supabase: getServiceRoleClient(), actorId: user.id, classroomId,
    enrollmentId: input.enrollmentId, hidden: input.hidden,
  }))
})

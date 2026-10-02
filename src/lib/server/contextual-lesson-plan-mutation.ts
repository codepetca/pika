import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { requireAuth, requireRole } from '@/lib/auth'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import {
  isClassroomExperienceAdmissionConfigured,
  resolveClassroomExperienceAdmission,
} from '@/lib/server/classroom-experience-admission'
import { isRetryableDatabaseContention } from '@/lib/server/database-contention'
import { getServiceRoleClient } from '@/lib/supabase'
import { getLessonPlanMarkdown } from '@/lib/lesson-plan-content'
import {
  contextualLessonPlanDateParamsSchema,
  contextualLessonPlanRowSchema,
  contextualLessonPlanRpcEnvelopeSchema,
} from '@/lib/validations/lesson-plan-mutations'
import type { AuthenticatedUser, TiptapContent } from '@/types'
import type { Json } from '@/types/database.generated'

const uuid = z.string().uuid().transform((value) => value.toLowerCase())

export async function authorizeContextualLessonPlanMutationActor(): Promise<
  { mode: 'legacy' | 'contextual'; user: AuthenticatedUser }
> {
  if (!isClassroomExperienceAdmissionConfigured()) {
    return { mode: 'legacy', user: await requireRole('teacher') }
  }
  const user = await requireAuth()
  if (resolveClassroomExperienceAdmission(user).status === 'not-admitted') {
    // Preserve the role guard for callers outside the dormant cohort.
    return { mode: 'legacy', user: await requireRole('teacher') }
  }
  return { mode: 'contextual', user }
}

export async function preflightContextualLessonPlanMutation(input: {
  actorId: string; params: unknown
}): Promise<{ actorId: string; classroomId: string; date: string }> {
  const parsed = contextualLessonPlanDateParamsSchema.safeParse(input.params)
  if (!parsed.success) throw new ApiError(400, 'Invalid lesson-plan date or classroom identifier')
  const actor = uuid.safeParse(input.actorId)
  if (!actor.success) throw new ApiError(503, 'Unable to verify lesson-plan owner')
  let context: Awaited<ReturnType<typeof resolveClassroomAccess>>
  try {
    context = await resolveClassroomAccess(actor.data, parsed.data.id)
  } catch {
    throw new ApiError(503, 'Unable to verify lesson-plan owner')
  }
  if (context === null) throw new ApiError(404, 'Classroom not found')
  if (context.userId !== actor.data || context.classroomId !== parsed.data.id) {
    throw new ApiError(503, 'Unable to verify lesson-plan owner')
  }
  if (context.relationship !== 'owner' || context.ownerId !== actor.data) throw new ApiError(403, 'Forbidden')
  if (context.archived) throw new ApiError(403, 'Classroom is archived')
  return { actorId: actor.data, classroomId: parsed.data.id, date: parsed.data.date }
}

function mapRpcError(error: { code?: string }): never {
  if (error.code === '42501') throw new ApiError(403, 'Forbidden')
  if (error.code === 'P0002') throw new ApiError(404, 'Classroom not found')
  if (error.code === '22023') throw new ApiError(400, 'Invalid lesson-plan save request')
  if (error.code === 'PT409' || isRetryableDatabaseContention(error)) {
    throw new ApiError(409, 'Lesson plan changed during this update. Refresh and try again.')
  }
  throw new ApiError(503, 'Unable to save lesson plan')
}

export async function saveContextualLessonPlan(input: {
  actorId: string
  classroomId: string
  date: string
  markdown: string
  content: TiptapContent
  shouldDelete: boolean
  mutation?: { client_id: string; sequence: number }
}): Promise<{ applied: boolean; lesson_plan: z.infer<typeof contextualLessonPlanRowSchema> | null }> {
  let response: unknown
  try {
    response = await getServiceRoleClient().rpc('save_lesson_plan_for_owner_v1', {
      p_actor_id: input.actorId,
      p_classroom_id: input.classroomId,
      p_date: input.date,
      p_content_markdown: input.markdown,
      p_content: input.content as unknown as Json,
      p_delete: input.shouldDelete,
      ...(input.mutation ? {
        p_client_id: input.mutation.client_id,
        p_sequence: input.mutation.sequence,
      } : {}),
    })
  } catch {
    throw new ApiError(503, 'Unable to save lesson plan')
  }
  const envelope = contextualLessonPlanRpcEnvelopeSchema.safeParse(response)
  if (!envelope.success) throw new ApiError(503, 'Unable to verify lesson-plan save')
  if (envelope.data.error !== null) mapRpcError(envelope.data.error)
  const result = envelope.data.data
  if ((!input.mutation && result.applied !== true)
    || (result.applied && input.shouldDelete && result.lesson_plan !== null)
    || (result.applied && !input.shouldDelete && result.lesson_plan === null)
    || (result.lesson_plan !== null && (
    result.lesson_plan.classroom_id !== input.classroomId
    || result.lesson_plan.date !== input.date
  ))) {
    throw new ApiError(503, 'Unable to verify lesson-plan save')
  }
  return {
    applied: result.applied,
    lesson_plan: result.lesson_plan === null ? null : {
      ...result.lesson_plan,
      content_markdown: getLessonPlanMarkdown(result.lesson_plan).markdown,
    },
  }
}

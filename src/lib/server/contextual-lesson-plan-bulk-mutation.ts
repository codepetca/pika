import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import { isRetryableDatabaseContention } from '@/lib/server/database-contention'
import { getLessonPlanMarkdown } from '@/lib/lesson-plan-content'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  contextualLessonPlanBulkParamsSchema,
  contextualLessonPlanBulkRpcEnvelopeSchema,
  contextualLessonPlanRowSchema,
} from '@/lib/validations/lesson-plan-mutations'
import type { TiptapContent } from '@/types'
import type { Json } from '@/types/database.generated'

const uuid = z.string().uuid().transform((value) => value.toLowerCase())

export async function preflightContextualLessonPlanBulkMutation(input: {
  actorId: string
  params: unknown
}): Promise<{ actorId: string; classroomId: string }> {
  const parsed = contextualLessonPlanBulkParamsSchema.safeParse(input.params)
  if (!parsed.success) throw new ApiError(400, 'Invalid classroom identifier')
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
  if (context.relationship !== 'owner' || context.ownerId !== actor.data) {
    throw new ApiError(403, 'Forbidden')
  }
  if (context.archived) throw new ApiError(403, 'Classroom is archived')
  return { actorId: actor.data, classroomId: parsed.data.id }
}

function mapRpcError(error: { code?: string }): never {
  if (error.code === '42501') throw new ApiError(403, 'Forbidden')
  if (error.code === 'P0002') throw new ApiError(404, 'Classroom not found')
  if (error.code === '22023') throw new ApiError(400, 'Invalid lesson-plan bulk request')
  if (error.code === 'PT409' || isRetryableDatabaseContention(error)) {
    throw new ApiError(409, 'Lesson plan changed during this update. Refresh and try again.')
  }
  throw new ApiError(503, 'Unable to save lesson plans')
}

type PlanInput = { date: string; content_markdown: string; content: TiptapContent }
type BulkResponse = {
  updated: number
  cleared: number
  lesson_plans: Array<z.infer<typeof contextualLessonPlanRowSchema>>
}

export async function saveContextualLessonPlanBulk(input: {
  actorId: string
  classroomId: string
  plans: PlanInput[]
  clearedDates: string[]
  mutation?: { client_id: string; sequence: number }
}): Promise<BulkResponse> {
  let response: unknown
  try {
    response = await getServiceRoleClient().rpc('save_lesson_plans_for_owner_v1', {
      p_actor_id: input.actorId,
      p_classroom_id: input.classroomId,
      p_plans: input.plans.map((plan) => ({
        date: plan.date,
        content_markdown: plan.content_markdown,
        content: plan.content as unknown as Json,
      })),
      p_cleared_dates: input.clearedDates,
      ...(input.mutation ? {
        p_client_id: input.mutation.client_id,
        p_sequence: input.mutation.sequence,
      } : {}),
    })
  } catch {
    throw new ApiError(503, 'Unable to save lesson plans')
  }

  const envelope = contextualLessonPlanBulkRpcEnvelopeSchema.safeParse(response)
  if (!envelope.success) throw new ApiError(503, 'Unable to verify lesson-plan bulk save')
  if (envelope.data.error !== null) mapRpcError(envelope.data.error)
  const results = envelope.data.data.results
  if (results.length !== input.plans.length + input.clearedDates.length) {
    throw new ApiError(503, 'Unable to verify lesson-plan bulk save')
  }
  let updated = 0
  let cleared = 0
  const lessonPlans: BulkResponse['lesson_plans'] = []
  for (const [index, result] of results.entries()) {
    const isSave = index < input.plans.length
    const expectedDate = isSave ? input.plans[index].date : input.clearedDates[index - input.plans.length]
    const expectedOperation = isSave ? 'upsert' : 'clear'
    const row = result.lesson_plan
    if (result.date !== expectedDate || result.operation !== expectedOperation
      || (!input.mutation && !result.applied)
      || (result.applied && isSave && row === null)
      || (result.applied && !isSave && row !== null)
      || (row !== null && (row.classroom_id !== input.classroomId || row.date !== expectedDate))) {
      throw new ApiError(503, 'Unable to verify lesson-plan bulk save')
    }
    if (isSave) {
      if (result.applied) updated += 1
      if (row !== null) {
        lessonPlans.push({ ...row, content_markdown: getLessonPlanMarkdown(row).markdown })
      }
    } else if (result.applied) {
      cleared += 1
    }
  }
  return { updated, cleared, lesson_plans: lessonPlans }
}

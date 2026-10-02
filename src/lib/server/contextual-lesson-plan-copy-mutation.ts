import { ApiError } from '@/lib/api-error'
import { isRetryableDatabaseContention } from '@/lib/server/database-contention'
import { getServiceRoleClient } from '@/lib/supabase'
import { contextualLessonPlanCopyRpcEnvelopeSchema } from '@/lib/validations/lesson-plan-mutations'

function mapRpcError(error: { code?: string }): never {
  if (error.code === '42501') throw new ApiError(403, 'Forbidden')
  if (error.code === 'P0002') throw new ApiError(404, 'Classroom not found')
  if (error.code === 'PT404') throw new ApiError(404, 'Source lesson plan not found')
  if (error.code === '22023') throw new ApiError(400, 'Invalid lesson-plan copy request')
  if (error.code === 'PT409' || isRetryableDatabaseContention(error)) {
    throw new ApiError(409, 'Lesson plan changed during this copy. Refresh and try again.')
  }
  throw new ApiError(503, 'Unable to copy lesson plan')
}

export async function copyContextualLessonPlan(input: {
  actorId: string
  classroomId: string
  fromDate: string
  toDate: string
}) {
  let response: unknown
  try {
    response = await getServiceRoleClient().rpc('copy_lesson_plan_for_owner_v1', {
      p_actor_id: input.actorId,
      p_classroom_id: input.classroomId,
      p_from_date: input.fromDate,
      p_to_date: input.toDate,
    })
  } catch {
    throw new ApiError(503, 'Unable to copy lesson plan')
  }
  const envelope = contextualLessonPlanCopyRpcEnvelopeSchema.safeParse(response)
  if (!envelope.success) throw new ApiError(503, 'Unable to verify lesson-plan copy')
  if (envelope.data.error !== null) mapRpcError(envelope.data.error)
  const row = envelope.data.data.lesson_plan
  if (row.classroom_id !== input.classroomId || row.date !== input.toDate) {
    throw new ApiError(503, 'Unable to verify lesson-plan copy')
  }
  return row
}

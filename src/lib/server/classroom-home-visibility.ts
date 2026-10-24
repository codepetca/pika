import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import type { getServiceRoleClient } from '@/lib/supabase'
import { classroomHomeVisibilityUuidSchema as uuid } from '@/lib/validations/classroom-home-visibility'

type SupabaseClient = ReturnType<typeof getServiceRoleClient>

const readResultSchema = z.object({
  actor_id: uuid,
  hidden_enrollment_ids: z.array(uuid).max(4096)
    .refine(ids => new Set(ids).size === ids.length),
}).strict()
const writeResultSchema = z.object({
  actor_id: uuid,
  classroom_id: uuid,
  enrollment_id: uuid,
  hidden: z.boolean(),
}).strict()
const writeIdentitySchema = z.object({
  actorId: uuid,
  classroomId: uuid,
  enrollmentId: uuid,
  hidden: z.boolean(),
}).strict()
const successEnvelopeSchema = z.object({
  data: z.unknown(),
  error: z.null(),
  status: z.number().int().min(200).max(299),
  statusText: z.string(),
  count: z.union([z.null(), z.literal(1)]),
}).strict()
const failureEnvelopeSchema = z.object({
  data: z.null(),
  error: z.object({ code: z.string(), message: z.string(), details: z.string().nullable(), hint: z.string().nullable() }).strict(),
  status: z.number().int().min(400).max(599),
  statusText: z.string(),
  count: z.null(),
}).strict()

export type ClassroomHomeVisibility = z.infer<typeof readResultSchema>
export type ClassroomHomeVisibilityWrite = z.infer<typeof writeResultSchema>

const unavailable = () => new ApiError(503, 'Classroom home visibility is unavailable; refresh to reconcile its outcome')

function successData(response: unknown): unknown {
  const failure = failureEnvelopeSchema.safeParse(response)
  if (failure.success) {
    const { code, message } = failure.data.error
    const status = failure.data.status
    if (status === 400 && code === 'PT400' && message === 'classroom_home_visibility_invalid_request') {
      throw new ApiError(400, 'Invalid classroom home visibility request')
    }
    if (status === 403 && code === 'PT403' && message === 'classroom_home_visibility_forbidden') {
      throw new ApiError(403, 'Forbidden')
    }
    if (status === 409 && code === 'PT409' && ['classroom_home_visibility_busy', 'classroom_home_visibility_membership_changed'].includes(message)) {
      throw new ApiError(409, 'Classroom membership changed or is busy; refresh and try again')
    }
    throw unavailable()
  }
  const success = successEnvelopeSchema.safeParse(response)
  if (!success.success) throw unavailable()
  return success.data.data
}

/** Actor identity must be supplied by the authenticated server caller. */
export async function readClassroomHomeVisibility(input: {
  supabase: SupabaseClient
  actorId: string
}): Promise<ClassroomHomeVisibility> {
  const identity = uuid.safeParse(input.actorId)
  if (!identity.success) throw unavailable()
  let response: unknown
  try {
    response = await input.supabase.rpc('read_classroom_home_visibility_v1', { p_actor_id: identity.data })
      .abortSignal(AbortSignal.timeout(10_000))
  } catch { throw unavailable() }
  const result = readResultSchema.safeParse(successData(response))
  if (!result.success || result.data.actor_id !== identity.data) throw unavailable()
  return result.data
}

/** One atomic write, without retries. A lost reply does not imply rollback. */
export async function setClassroomHomeVisibility(input: {
  supabase: SupabaseClient
  actorId: string
  classroomId: string
  enrollmentId: string
  hidden: boolean
}): Promise<ClassroomHomeVisibilityWrite> {
  const { supabase, ...context } = input
  const identity = writeIdentitySchema.safeParse(context)
  if (!identity.success) throw unavailable()
  const { actorId, classroomId, enrollmentId, hidden } = identity.data
  let response: unknown
  try {
    response = await supabase.rpc('set_classroom_home_visibility_v1', {
      p_actor_id: actorId,
      p_classroom_id: classroomId,
      p_expected_enrollment_id: enrollmentId,
      p_hidden: hidden,
    }).abortSignal(AbortSignal.timeout(10_000))
  } catch { throw unavailable() }
  const result = writeResultSchema.safeParse(successData(response))
  if (!result.success || result.data.actor_id !== actorId || result.data.classroom_id !== classroomId
    || result.data.enrollment_id !== enrollmentId || result.data.hidden !== hidden) throw unavailable()
  return result.data
}

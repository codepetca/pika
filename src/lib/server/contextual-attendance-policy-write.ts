import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import type { getServiceRoleClient } from '@/lib/supabase'
import type { teacherAttendancePolicyUpdateSchema } from '@/lib/validations/teacher-attendance-policy'
import { getBaraAttendanceIntegrationState } from '@/lib/server/bara-attendance-client'
import { getBaraAttendanceCanaryScope } from '@/lib/server/bara-attendance-canary'
import { getBaraAttendanceScopeMode } from '@/lib/server/bara-attendance-scope'
import { savedPolicySchema, toSavedTeacherAttendancePolicy } from '@/lib/server/bara-attendance-policy'

const identitySchema = z.object({ actorId: z.string().uuid(), classroomId: z.string().uuid() }).strict()
const resultSchema = z.object({ actor_id: z.string().uuid(), classroom_id: z.string().uuid(),
  scope_mode: z.enum(['exact_canary','teacher_entitlements']), policy: savedPolicySchema }).strict()
const successSchema = z.object({ data: resultSchema, error: z.null(), status: z.number().int().min(200).max(299),
  statusText: z.string(), count: z.union([z.null(), z.literal(1)]) }).strict()
const errorSchema = z.object({ data: z.null(), error: z.object({ code: z.enum(['PT400','PT403','PT404','PT409','PT503']),
  message: z.string(), details: z.string().nullable(), hint: z.string().nullable() }).strict(),
  status: z.number().int().min(400).max(599), statusText: z.string(), count: z.null() }).strict()
  .refine(value => value.status === Number(value.error.code.slice(2)))
const unavailable = () => new ApiError(503, 'Attendance settings are temporarily unavailable')
const disabled = () => new ApiError(404, 'Attendance is not enabled for this classroom')

/** The route parses the existing feature-owned request schema once. SQL owns
 * current authorization, revision mutation and revocation serialization. */
export async function saveContextualAttendancePolicy(input: {
  supabase: ReturnType<typeof getServiceRoleClient>; actorId: string;
  policy: z.infer<typeof teacherAttendancePolicyUpdateSchema>
}) {
  const identity = identitySchema.parse({ actorId: input.actorId, classroomId: input.policy.classroom_id })
  const { classroom_id: _classroomId, ...policy } = input.policy
  const state = getBaraAttendanceIntegrationState()
  if (state === 'disabled') throw disabled()
  if (state !== 'ready') throw unavailable()
  const mode = getBaraAttendanceScopeMode()
  const canary = mode === 'exact_canary' ? getBaraAttendanceCanaryScope() : null
  if (canary && canary.state !== 'ready') throw canary.state === 'disabled' ? disabled() : unavailable()
  let response: unknown
  try {
    response = await input.supabase.rpc('save_attendance_policy_for_owner_v1', {
      p_actor_id: identity.actorId, p_classroom_id: identity.classroomId, p_scope_mode: mode, p_policy: policy,
      p_canary_actor_id: canary?.teacherId ?? null, p_canary_classroom_id: canary?.classroomId ?? null,
    }).abortSignal(AbortSignal.timeout(10_000))
  } catch { throw unavailable() }
  const failure = errorSchema.safeParse(response)
  if (failure.success) {
    const code = failure.data.error.code
    if (code === 'PT400') throw new ApiError(400, 'Invalid attendance settings')
    if (code === 'PT403') throw new ApiError(403, 'Classroom access is unavailable')
    if (code === 'PT404') throw disabled()
    if (code === 'PT409') throw new ApiError(409, 'Attendance settings changed; refresh and try again')
    throw unavailable()
  }
  const parsed = successSchema.safeParse(response)
  if (!parsed.success) throw unavailable()
  const result = parsed.data.data, saved = result.policy
  if (result.actor_id !== identity.actorId || result.classroom_id !== identity.classroomId || result.scope_mode !== mode
    || saved.classroom_id !== identity.classroomId || saved.revision !== (policy.expected_revision ?? 0) + 1
    || (canary && (canary.teacherId !== identity.actorId || canary.classroomId !== identity.classroomId))) throw unavailable()
  const { expected_revision: _revision, ...values } = policy
  for (const key of Object.keys(values) as (keyof typeof values)[]) if (saved[key] !== values[key]) throw unavailable()
  return toSavedTeacherAttendancePolicy(saved)
}

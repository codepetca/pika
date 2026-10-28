import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import type { getServiceRoleClient } from '@/lib/supabase'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { getBaraAttendanceIntegrationState } from '@/lib/server/bara-attendance-client'
import { getBaraAttendanceCanaryScope } from '@/lib/server/bara-attendance-canary'
import { getBaraAttendanceScopeMode } from '@/lib/server/bara-attendance-scope'
import { attendancePolicyRowSchema, toTeacherAttendancePolicy } from '@/lib/server/bara-attendance-policy'

const identitySchema = z.object({ actorId: z.string().uuid(), classroomId: z.string().uuid() }).strict()
const snapshotSchema = z.object({
  actor_id: z.string().uuid(), classroom_id: z.string().uuid(),
  scope_mode: z.enum(['exact_canary', 'teacher_entitlements']),
  status: z.enum(['ready', 'forbidden', 'archived', 'blocked', 'disabled']),
  policy: attendancePolicyRowSchema.nullable(),
}).strict().refine(value => value.status === 'ready' || value.policy === null)
const envelopeSchema = z.object({
  data: snapshotSchema, error: z.null(), status: z.number().int().min(200).max(299),
  statusText: z.string(), count: z.union([z.null(), z.literal(1)]),
}).strict()
const unavailable = () => new ApiError(503, 'Attendance settings are temporarily unavailable')
const disabled = () => new ApiError(404, 'Attendance is not enabled for this classroom')

/** Cohort selection grants no relationship or attendance entitlement. */
export async function authorizeSharedAttendancePolicyActor() {
  if (!isClassroomExperienceAdmissionConfigured()) return { mode: 'existing' as const }
  const user = await requireAuth()
  return (await resolveClassroomExperienceAdmission(user)).status === 'admitted'
    ? { mode: 'shared' as const, user } : { mode: 'existing' as const }
}

/** One bounded, read-only SQL snapshot binds current owner, lifecycle, scope and policy. */
export async function loadContextualAttendancePolicy(input: {
  supabase: ReturnType<typeof getServiceRoleClient>; actorId: string; classroomId: string
}) {
  const identity = identitySchema.parse({ actorId: input.actorId, classroomId: input.classroomId })
  const state = getBaraAttendanceIntegrationState()
  if (state === 'disabled') throw disabled()
  if (state !== 'ready') throw unavailable()
  const mode = getBaraAttendanceScopeMode()
  const canary = mode === 'exact_canary' ? getBaraAttendanceCanaryScope() : null
  if (canary && canary.state !== 'ready') throw canary.state === 'disabled' ? disabled() : unavailable()
  let response: unknown
  try {
    response = await input.supabase.rpc('read_attendance_policy_for_owner_v1', {
      p_actor_id: identity.actorId, p_classroom_id: identity.classroomId, p_scope_mode: mode,
      p_canary_actor_id: canary?.teacherId ?? null, p_canary_classroom_id: canary?.classroomId ?? null,
    }).abortSignal(AbortSignal.timeout(10_000))
  } catch { throw unavailable() }
  const parsed = envelopeSchema.safeParse(response)
  if (!parsed.success) throw unavailable()
  const snapshot = parsed.data.data
  if (snapshot.actor_id !== identity.actorId || snapshot.classroom_id !== identity.classroomId
    || snapshot.scope_mode !== mode || (snapshot.policy && snapshot.policy.classroom_id !== identity.classroomId)) throw unavailable()
  if (snapshot.status === 'ready' && canary
    && (canary.teacherId !== identity.actorId || canary.classroomId !== identity.classroomId)) throw unavailable()
  if (snapshot.status === 'forbidden') throw new ApiError(403, 'Classroom access is unavailable')
  if (snapshot.status === 'archived') throw new ApiError(403, 'Classroom is archived')
  if (snapshot.status === 'blocked') throw unavailable()
  if (snapshot.status === 'disabled') throw disabled()
  return snapshot.policy === null ? null : toTeacherAttendancePolicy(snapshot.policy)
}

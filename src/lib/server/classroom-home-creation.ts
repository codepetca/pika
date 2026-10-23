import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { requireAuth, requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { isContextualClassroomHomeAdmitted } from '@/lib/server/contextual-classroom-home'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'

type CreationClient = Pick<ReturnType<typeof getServiceRoleClient>, 'rpc'>
const canonicalUuid = z.string().uuid().transform(value => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true })
const creationAccessSchema = z.object({
  subject_user_id: canonicalUuid,
  feature_key: z.literal('classrooms.create'),
  managed: z.boolean(),
  allowed: z.boolean(),
  reason: z.enum(['allowed', 'legacy', 'disabled', 'not_started', 'expired', 'active_limit_reached', 'unavailable']),
  source: z.enum(['legacy', 'plan', 'trial', 'manual', 'school']).nullable(),
  starts_at: timestamp.nullable(),
  expires_at: timestamp.nullable(),
  quota_limit: z.number().int().nonnegative().nullable(),
  active_count: z.number().int().nonnegative(),
  revision: z.number().int().positive().nullable(),
}).strict().superRefine((value, context) => {
  const consistent = value.allowed === (value.reason === 'allowed' || value.reason === 'legacy')
    && (value.managed
      ? value.source !== null && value.starts_at !== null && value.revision !== null
        && value.reason !== 'legacy' && value.reason !== 'unavailable'
      : value.source === null && value.starts_at === null && value.expires_at === null
        && value.quota_limit === null && value.revision === null
        && (value.reason === 'legacy' || value.reason === 'unavailable'))
  if (!consistent) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid classroom creation evidence' })
})

const unavailable = () => new ApiError(503, 'Classroom creation is temporarily unavailable. Please try again.')
const creationAccessEnvelopeSchema = z.object({ data: creationAccessSchema, error: z.null() })

/** Home admission and the complete classroom experience are independent gates. */
export async function authorizeClassroomHomeActor() {
  if (process.env.PIKA_CLASSROOM_HOME_ACCESS_ENABLED === 'true' && isClassroomExperienceAdmissionConfigured()) {
    const user = await requireAuth()
    const sharedAdmission = resolveClassroomExperienceAdmission(user)
    if (isContextualClassroomHomeAdmitted(user) && sharedAdmission.status === 'admitted') {
      return { user, contextual: true }
    }
  }
  return { user: await requireRole('teacher'), contextual: false }
}

async function readCreationAccess(actorId: string, supabase: CreationClient) {
  const actor = canonicalUuid.safeParse(actorId)
  if (!actor.success) throw unavailable()
  let response: unknown
  try {
    response = await supabase.rpc('get_classroom_creation_access_v1', { p_subject_user_id: actor.data })
  } catch {
    throw unavailable()
  }
  const parsed = creationAccessEnvelopeSchema.safeParse(response)
  if (!parsed.success || parsed.data.data.subject_user_id !== actor.data
    || parsed.data.data.reason === 'unavailable') throw unavailable()
  return parsed.data.data
}

/** A display hint only: the installed writer rechecks live entitlement and capacity. */
export async function loadClassroomHomeCreationAccess(actorId: string, supabase: CreationClient): Promise<{ canCreate: boolean }> {
  const access = await readCreationAccess(actorId, supabase)
  return { canCreate: access.managed && access.allowed }
}

/**
 * New capability entry cannot inherit unmanaged legacy creation. Do not deny on
 * current capacity or expiry here: a completed operation may still need replay.
 * The atomic writer authorizes every new insertion under the entitlement lock.
 */
export async function assertManagedClassroomHomeCreationAccess(actorId: string, supabase: CreationClient): Promise<void> {
  if (!(await readCreationAccess(actorId, supabase)).managed) throw unavailable()
}

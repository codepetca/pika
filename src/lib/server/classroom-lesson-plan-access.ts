import { z } from 'zod'
import { canAccessClassroom, type ClassroomAccessContext } from '@/lib/access/classroom-policy'
import { ApiError } from '@/lib/api-error'
import { AuthorizationError, requireAuth, requireRole } from '@/lib/auth'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import type { AuthenticatedUser, UserRole } from '@/types'

type LessonPlanPermission = 'owner' | 'member'
type LessonPlanAccess =
  | { mode: 'legacy'; user: AuthenticatedUser }
  | { mode: 'contextual'; user: AuthenticatedUser; context: ClassroomAccessContext }

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const lessonPlanPairsSchema = z.array(z.object({
  userId: canonicalUuid,
  classroomId: canonicalUuid,
}).strict()).max(100)
const lessonPlanRowSchema = z.object({
  id: canonicalUuid,
  classroom_id: canonicalUuid,
}).passthrough()
const lessonPlanClassroomSchema = z.object({
  id: canonicalUuid,
  lesson_plan_visibility: z.enum(['current_week', 'one_week_ahead', 'all']).nullable(),
}).passthrough()
const canonicalDateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
})

function configuredLessonPlanPairs(): z.infer<typeof lessonPlanPairsSchema> | null {
  const raw = process.env.PIKA_CLASSROOM_LESSON_PLANS_ACCESS_PAIRS
  if (!raw || raw.length > 20_000) return null
  try {
    const parsed = lessonPlanPairsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * Dormant, exact-pair authorization for lesson-plan list reads. Legacy mode
 * preserves the original role and classroom guards. Contextual mode derives the
 * relationship from the authenticated identity and trusted classroom records.
 * Lesson-plan writes remain outside this gate.
 */
export async function authorizeClassroomLessonPlanRequest(
  classroomId: string | (() => Promise<string>),
  options: { legacyRole: UserRole; permission: LessonPlanPermission },
): Promise<LessonPlanAccess> {
  if (process.env.PIKA_CLASSROOM_LESSON_PLANS_ACCESS_ENABLED !== 'true') {
    return { mode: 'legacy', user: await requireRole(options.legacyRole) }
  }

  const user = await requireAuth()
  const pairs = configuredLessonPlanPairs()
  const identity = canonicalUuid.safeParse(user.id)
  if (pairs === null || !identity.success) {
    throw new ApiError(503, 'Classroom lesson-plan access configuration is unavailable')
  }

  const requestedId = canonicalUuid.safeParse(
    typeof classroomId === 'function' ? await classroomId() : classroomId
  )
  if (!requestedId.success) {
    if (user.role !== options.legacyRole) {
      throw new AuthorizationError(`Forbidden: ${options.legacyRole} role required`)
    }
    throw new ApiError(400, 'Invalid classroom identifier')
  }
  if (!pairs.some((pair) => (
    pair.userId === identity.data && pair.classroomId === requestedId.data
  ))) {
    if (user.role !== options.legacyRole) {
      throw new AuthorizationError(`Forbidden: ${options.legacyRole} role required`)
    }
    return { mode: 'legacy', user }
  }

  const context = await resolveClassroomAccess(identity.data, requestedId.data)
  if (context === null) throw new ApiError(404, 'Classroom not found')
  const allowed = options.permission === 'owner'
    ? context.relationship === 'owner' && canAccessClassroom(context, 'read')
    : canAccessClassroom(context, 'participate')
  if (!allowed) throw new ApiError(403, 'Forbidden')
  return { mode: 'contextual', user, context }
}

/** Contextual service-role reads must not disclose malformed or cross-class rows. */
export function assertContextualLessonPlanRows(
  classroomId: string,
  rows: unknown,
): asserts rows is Array<z.infer<typeof lessonPlanRowSchema>> {
  const requestedId = canonicalUuid.safeParse(classroomId)
  const parsed = z.array(lessonPlanRowSchema).safeParse(rows)
  if (
    !requestedId.success
    || !parsed.success
    || parsed.data.some((row) => row.classroom_id !== requestedId.data)
  ) {
    throw new ApiError(503, 'Unable to verify classroom lesson plans')
  }
}

/** Bind the member visibility record to the requested classroom before use. */
export function assertContextualLessonPlanClassroom(
  classroomId: string,
  row: unknown,
): asserts row is z.infer<typeof lessonPlanClassroomSchema> {
  const requestedId = canonicalUuid.safeParse(classroomId)
  const parsed = lessonPlanClassroomSchema.safeParse(row)
  if (!requestedId.success || !parsed.success || parsed.data.id !== requestedId.data) {
    throw new ApiError(503, 'Unable to verify lesson-plan visibility')
  }
}

/** PostgreSQL accepts aliases that cannot be compared safely to ISO visibility limits. */
export function assertContextualLessonPlanDateRange(start: string, end: string): void {
  if (!canonicalDateOnly.safeParse(start).success || !canonicalDateOnly.safeParse(end).success) {
    throw new ApiError(400, 'start and end must use YYYY-MM-DD')
  }
}

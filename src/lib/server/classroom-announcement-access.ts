import { z } from 'zod'
import { canAccessClassroom, type ClassroomAccessContext } from '@/lib/access/classroom-policy'
import { ApiError } from '@/lib/api-error'
import { AuthorizationError, requireAuth, requireRole } from '@/lib/auth'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import type { AuthenticatedUser, UserRole } from '@/types'

type AnnouncementPermission = 'owner' | 'member'
type AnnouncementAccess =
  | { mode: 'legacy'; user: AuthenticatedUser }
  | { mode: 'contextual'; user: AuthenticatedUser; context: ClassroomAccessContext }

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const announcementPairsSchema = z.array(z.object({
  userId: canonicalUuid,
  classroomId: canonicalUuid,
}).strict()).max(100)
const announcementRowSchema = z.object({
  id: canonicalUuid,
  classroom_id: canonicalUuid,
}).passthrough()

function configuredAnnouncementPairs(): z.infer<typeof announcementPairsSchema> | null {
  const raw = process.env.PIKA_CLASSROOM_ANNOUNCEMENTS_ACCESS_PAIRS
  if (!raw || raw.length > 20_000) return null
  try {
    const parsed = announcementPairsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * Dormant, exact-pair authorization for the announcement read slice.
 * Legacy mode authenticates with the original role guard and leaves the existing
 * classroom guard authoritative. Contextual mode uses only server session identity
 * plus trusted owner/enrollment evidence. This gate is deliberately independent from
 * the page and classroom-core pilots so deploying a new domain cannot widen them.
 * Announcement mutations and member read receipts are intentionally out of scope.
 */
export async function authorizeClassroomAnnouncementRequest(
  classroomId: string | (() => Promise<string>),
  options: { legacyRole: UserRole; permission: AnnouncementPermission },
): Promise<AnnouncementAccess> {
  if (process.env.PIKA_CLASSROOM_ANNOUNCEMENTS_ACCESS_ENABLED !== 'true') {
    return { mode: 'legacy', user: await requireRole(options.legacyRole) }
  }

  const user = await requireAuth()
  const pairs = configuredAnnouncementPairs()
  const identity = canonicalUuid.safeParse(user.id)
  if (pairs === null || !identity.success) {
    throw new ApiError(503, 'Classroom announcement access configuration is unavailable')
  }

  const requestedId = canonicalUuid.safeParse(
    typeof classroomId === 'function' ? await classroomId() : classroomId
  )
  if (!requestedId.success) {
    // Preserve the legacy role-first response for wrong-role callers. A valid
    // classroom identifier is required before an exact contextual pair can be
    // established, so malformed identifiers cannot opt into the pilot path.
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
export function assertContextualAnnouncementRows(
  classroomId: string,
  rows: unknown,
): asserts rows is Array<z.infer<typeof announcementRowSchema>> {
  const requestedId = canonicalUuid.safeParse(classroomId)
  const parsed = z.array(announcementRowSchema).safeParse(rows)
  if (
    !requestedId.success
    || !parsed.success
    || parsed.data.some((row) => row.classroom_id !== requestedId.data)
  ) {
    throw new ApiError(503, 'Unable to verify classroom announcements')
  }
}

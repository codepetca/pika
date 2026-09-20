import { z } from 'zod'
import { canAccessClassroom, type ClassroomAccessContext } from '@/lib/access/classroom-policy'
import { ApiError } from '@/lib/api-error'
import { AuthorizationError, requireAuth, requireRole } from '@/lib/auth'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import type { AuthenticatedUser, UserRole } from '@/types'

type MaterialPermission = 'owner' | 'member'
type MaterialAccess =
  | { mode: 'legacy'; user: AuthenticatedUser }
  | { mode: 'contextual'; user: AuthenticatedUser; context: ClassroomAccessContext }

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const materialPairsSchema = z.array(z.object({
  userId: canonicalUuid,
  classroomId: canonicalUuid,
}).strict()).max(100)
const materialRowSchema = z.object({
  id: canonicalUuid,
  classroom_id: canonicalUuid,
}).passthrough()
const publishedMaterialRowSchema = materialRowSchema.extend({
  is_draft: z.literal(false),
})

function configuredMaterialPairs(): z.infer<typeof materialPairsSchema> | null {
  const raw = process.env.PIKA_CLASSROOM_MATERIALS_ACCESS_PAIRS
  if (!raw || raw.length > 20_000) return null
  try {
    const parsed = materialPairsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * Dormant exact-pair authorization for classroom material list reads. Legacy
 * mode preserves the original role and classroom guards. Contextual mode derives
 * owner/member access from the authenticated identity and trusted relationship
 * records. Material writes remain outside this gate.
 */
export async function authorizeClassroomMaterialRequest(
  classroomId: string | (() => Promise<string>),
  options: { legacyRole: UserRole; permission: MaterialPermission },
): Promise<MaterialAccess> {
  if (process.env.PIKA_CLASSROOM_MATERIALS_ACCESS_ENABLED !== 'true') {
    return { mode: 'legacy', user: await requireRole(options.legacyRole) }
  }

  const user = await requireAuth()
  const pairs = configuredMaterialPairs()
  const identity = canonicalUuid.safeParse(user.id)
  if (pairs === null || !identity.success) {
    throw new ApiError(503, 'Classroom material access configuration is unavailable')
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
export function assertContextualMaterialRows(
  classroomId: string,
  rows: unknown,
): asserts rows is Array<z.infer<typeof materialRowSchema>> {
  const requestedId = canonicalUuid.safeParse(classroomId)
  const parsed = z.array(materialRowSchema).safeParse(rows)
  if (
    !requestedId.success
    || !parsed.success
    || parsed.data.some((row) => row.classroom_id !== requestedId.data)
  ) {
    throw new ApiError(503, 'Unable to verify classroom materials')
  }
}

/** Member reads must independently prove the published-only projection. */
export function assertContextualPublishedMaterialRows(
  classroomId: string,
  rows: unknown,
): asserts rows is Array<z.infer<typeof publishedMaterialRowSchema>> {
  const requestedId = canonicalUuid.safeParse(classroomId)
  const parsed = z.array(publishedMaterialRowSchema).safeParse(rows)
  if (
    !requestedId.success
    || !parsed.success
    || parsed.data.some((row) => row.classroom_id !== requestedId.data)
  ) {
    throw new ApiError(503, 'Unable to verify published classroom materials')
  }
}

import { z } from 'zod'
import { AuthorizationError, requireAuth, requireRole } from '@/lib/auth'
import { ApiError } from '@/lib/api-error'
import { getServiceRoleClient } from '@/lib/supabase'
import { canAccessClassroom, type ClassroomAccessContext } from '@/lib/access/classroom-policy'
import { classroomAccessRowSchema, resolveClassroomAccessFromRecord } from './classroom-access'
import type { AuthenticatedUser, UserRole } from '@/types'
import type { TableRow } from '@/types/database'

type CorePermission = 'owner' | 'member' | 'read'
type CoreAccess =
  | { mode: 'legacy'; user: AuthenticatedUser }
  | { mode: 'contextual'; user: AuthenticatedUser; classroom: TableRow<'classrooms'>; context: ClassroomAccessContext }

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const pilotPairsSchema = z.array(z.object({
  userId: canonicalUuid, classroomId: canonicalUuid,
}).strict()).max(100)

function pilotPairs(): z.infer<typeof pilotPairsSchema> | null {
  const raw = process.env.PIKA_CLASSROOM_CORE_ACCESS_PAIRS
  if (!raw || raw.length > 20_000) return null
  try {
    const parsed = pilotPairsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * Only the explicitly migrated classroom-core endpoints may call this gate.
 * Legacy mode authenticates but leaves existing route authorization authoritative.
 * Contextual mode authenticates, fetches trusted data and authorizes the requested
 * relationship. No role rewriting, creation grants, client plan claims or billing.
 * An owner read permits archived access; callers MUST apply explicit mutation and
 * lifecycle rules and bind owner/archive state in the write itself.
 */
export async function authorizeClassroomCoreRequest(
  classroomId: string,
  options: { legacyRole?: UserRole; permission: CorePermission },
): Promise<CoreAccess> {
  if (process.env.PIKA_CLASSROOM_CORE_ACCESS_ENABLED !== 'true') {
    return { mode: 'legacy', user: options.legacyRole ? await requireRole(options.legacyRole) : await requireAuth() }
  }
  const user = await requireAuth()
  const pairs = pilotPairs()
  const identity = canonicalUuid.safeParse(user.id)
  if (pairs === null || !identity.success) throw new ApiError(503, 'Classroom access configuration is unavailable')
  const requestedId = canonicalUuid.safeParse(classroomId)
  // PostgreSQL also accepts dashless/braced UUIDs. Never let an unrecognized
  // spelling of an admitted class escape to the legacy authorization path.
  if (!requestedId.success) throw new ApiError(400, 'Invalid classroom identifier')
  if (!pairs.some((pair) => pair.userId === identity.data && pair.classroomId === requestedId.data)) {
    if (options.legacyRole && user.role !== options.legacyRole) {
      throw new AuthorizationError(`Forbidden: ${options.legacyRole} role required`)
    }
    return { mode: 'legacy', user }
  }

  const resolvedId = requestedId.data
  const supabase = getServiceRoleClient()
  const { data: classroom, error } = await supabase.from('classrooms').select('*').eq('id', resolvedId).maybeSingle()
  if (error) throw new ApiError(503, 'Unable to resolve classroom access')
  if (classroom === null) throw new ApiError(404, 'Classroom not found')
  const context = await resolveClassroomAccessFromRecord(identity.data, resolvedId, classroom, { supabase })
  const allowed = options.permission === 'owner'
    ? context.relationship === 'owner' && canAccessClassroom(context, 'read')
    : options.permission === 'member' ? canAccessClassroom(context, 'participate')
      : options.permission === 'read' && canAccessClassroom(context, 'read')
  if (!allowed) throw new ApiError(403, 'Forbidden')
  return { mode: 'contextual', user, classroom, context }
}

/** Do not disclose a malformed or substituted post-write record. */
export function assertClassroomCoreWriteResponse(classroomId: string, ownerId: string, record: unknown): void {
  const parsed = classroomAccessRowSchema.safeParse(record)
  if (!parsed.success || parsed.data.id !== classroomId || parsed.data.teacher_id !== ownerId) {
    throw new ApiError(503, 'Unable to verify updated classroom')
  }
}

/** Members fetch visible guide content through the separately guarded guide endpoint. */
export function classroomCoreMemberRecord(record: TableRow<'classrooms'>): TableRow<'classrooms'> {
  return { ...record, course_overview_markdown: '', course_outline_markdown: '' }
}

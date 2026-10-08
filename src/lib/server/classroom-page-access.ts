import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { canAccessClassroom, type ClassroomAccessContext } from '@/lib/access/classroom-policy'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import { getServiceRoleClient } from '@/lib/supabase'
import type { AuthenticatedUser } from '@/types'

type SupabaseClient = ReturnType<typeof getServiceRoleClient>

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const classroomPagePairsSchema = z.array(z.object({
  userId: canonicalUuid,
  classroomId: canonicalUuid,
}).strict()).max(100)

export type ClassroomPagePilotAccess =
  | { mode: 'legacy' }
  | { mode: 'contextual'; context: ClassroomAccessContext }

function configuredClassroomPagePairs(): z.infer<typeof classroomPagePairsSchema> | null {
  const raw = process.env.PIKA_CLASSROOM_PAGE_ACCESS_PAIRS
  if (!raw || raw.length > 20_000) return null
  try {
    const parsed = classroomPagePairsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * Resolve the dormant SSR classroom-page pilot for an already-authenticated identity.
 * This gate is deliberately independent from the classroom-core API pilot so a deploy
 * cannot widen page access for an API-only cohort. Unmatched pairs preserve the exact
 * legacy page branch; admitted pairs use trusted owner/enrollment evidence only.
 */
export async function resolveClassroomPagePilotAccess(
  user: AuthenticatedUser,
  classroomId: string,
  options: { supabase?: SupabaseClient } = {},
): Promise<ClassroomPagePilotAccess> {
  if (process.env.PIKA_CLASSROOM_PAGE_ACCESS_ENABLED !== 'true') {
    return { mode: 'legacy' }
  }

  const pairs = configuredClassroomPagePairs()
  const identity = canonicalUuid.safeParse(user.id)
  if (pairs === null || !identity.success) {
    throw new ApiError(503, 'Classroom page access configuration is unavailable')
  }

  const requestedId = canonicalUuid.safeParse(classroomId)
  if (!requestedId.success) throw new ApiError(400, 'Invalid classroom identifier')
  if (!pairs.some((pair) => (
    pair.userId === identity.data && pair.classroomId === requestedId.data
  ))) {
    return { mode: 'legacy' }
  }

  const context = await resolveClassroomAccess(identity.data, requestedId.data, {
    supabase: options.supabase ?? getServiceRoleClient(),
  })
  if (context === null) throw new ApiError(404, 'Classroom not found')
  if (!canAccessClassroom(context, 'read')) throw new ApiError(403, 'Forbidden')
  return { mode: 'contextual', context }
}

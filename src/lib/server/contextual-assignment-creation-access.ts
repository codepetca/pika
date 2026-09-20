import { z } from 'zod'

import { ApiError } from '@/lib/api-error'
import { AuthorizationError, requireAuth, requireRole } from '@/lib/auth'
import type { AuthenticatedUser } from '@/types'

export type ContextualAssignmentCreationAccess =
  | { mode: 'legacy'; user: AuthenticatedUser; classroomId: string }
  | { mode: 'contextual'; user: AuthenticatedUser; classroomId: string }

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const classroomPairsSchema = z.array(z.object({
  userId: canonicalUuid,
  classroomId: canonicalUuid,
}).strict()).max(100)

function configuredClassroomPairs(): z.infer<typeof classroomPairsSchema> | null {
  const raw = process.env.PIKA_CLASSROOM_ASSIGNMENT_CREATION_ACCESS_PAIRS
  if (!raw || raw.length > 20_000) return null
  try {
    const parsed = classroomPairsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Dormant exact-pair admission for creating an Assignment in one Classroom. */
export async function authorizeContextualAssignmentCreationRequest(
  classroomId: string | (() => string | Promise<string>),
): Promise<ContextualAssignmentCreationAccess> {
  if (process.env.PIKA_CLASSROOM_ASSIGNMENT_CREATION_ACCESS_ENABLED !== 'true') {
    const user = await requireRole('teacher')
    const resolvedClassroomId = typeof classroomId === 'function'
      ? await classroomId()
      : classroomId
    return { mode: 'legacy', user, classroomId: resolvedClassroomId }
  }

  const user = await requireAuth()
  const pairs = configuredClassroomPairs()
  const identity = canonicalUuid.safeParse(user.id)
  if (pairs === null || !identity.success) {
    throw new ApiError(503, 'Classroom assignment creation configuration is unavailable')
  }

  const rawClassroomId = typeof classroomId === 'function'
    ? await classroomId()
    : classroomId
  const requestedId = canonicalUuid.safeParse(rawClassroomId)
  if (!requestedId.success || !pairs.some((pair) => (
    pair.userId === identity.data && pair.classroomId === requestedId.data
  ))) {
    if (user.role !== 'teacher') {
      throw new AuthorizationError('Forbidden: teacher role required')
    }
    return { mode: 'legacy', user, classroomId: rawClassroomId }
  }

  return { mode: 'contextual', user, classroomId: requestedId.data }
}

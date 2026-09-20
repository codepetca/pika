import { z } from 'zod'

import { ApiError } from '@/lib/api-error'
import { AuthorizationError, requireAuth, requireRole } from '@/lib/auth'
import type { AuthenticatedUser } from '@/types'

export type ContextualAssignmentFeedbackReturnAccess =
  | { mode: 'legacy'; user: AuthenticatedUser; assignmentId: string }
  | { mode: 'contextual'; user: AuthenticatedUser; assignmentId: string }

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const assignmentPairsSchema = z.array(z.object({
  userId: canonicalUuid,
  assignmentId: canonicalUuid,
}).strict()).max(100)

function configuredAssignmentPairs(): z.infer<typeof assignmentPairsSchema> | null {
  const raw = process.env.PIKA_CLASSROOM_ASSIGNMENT_FEEDBACK_RETURN_ACCESS_PAIRS
  if (!raw || raw.length > 20_000) return null
  try {
    const parsed = assignmentPairsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Dormant exact-pair admission for returning feedback from one Assignment. */
export async function authorizeContextualAssignmentFeedbackReturnRequest(
  assignmentId: string | (() => string | Promise<string>),
): Promise<ContextualAssignmentFeedbackReturnAccess> {
  if (process.env.PIKA_CLASSROOM_ASSIGNMENT_FEEDBACK_RETURN_ACCESS_ENABLED !== 'true') {
    const user = await requireRole('teacher')
    const resolvedAssignmentId = typeof assignmentId === 'function'
      ? await assignmentId()
      : assignmentId
    return { mode: 'legacy', user, assignmentId: resolvedAssignmentId }
  }

  const user = await requireAuth()
  const pairs = configuredAssignmentPairs()
  const identity = canonicalUuid.safeParse(user.id)
  if (pairs === null || !identity.success) {
    throw new ApiError(503, 'Classroom assignment feedback return configuration is unavailable')
  }

  const rawAssignmentId = typeof assignmentId === 'function'
    ? await assignmentId()
    : assignmentId
  const requestedId = canonicalUuid.safeParse(rawAssignmentId)
  if (!requestedId.success || !pairs.some((pair) => (
    pair.userId === identity.data && pair.assignmentId === requestedId.data
  ))) {
    if (user.role !== 'teacher') {
      throw new AuthorizationError('Forbidden: teacher role required')
    }
    return { mode: 'legacy', user, assignmentId: rawAssignmentId }
  }

  return { mode: 'contextual', user, assignmentId: requestedId.data }
}

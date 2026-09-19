import { z } from 'zod'

import { ApiError } from '@/lib/api-error'
import type { AuthenticatedUser } from '@/types'

export type ContextualAssignmentDocAccess =
  | { mode: 'legacy'; user: AuthenticatedUser; assignmentId: string }
  | { mode: 'contextual'; user: AuthenticatedUser; assignmentId: string }

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const assignmentPairsSchema = z.array(z.object({
  userId: canonicalUuid,
  assignmentId: canonicalUuid,
}).strict()).max(100)
const githubIdentitySchema = z.object({
  id: canonicalUuid,
  user_id: canonicalUuid,
}).passthrough()

function configuredAssignmentPairs(): z.infer<typeof assignmentPairsSchema> | null {
  const raw = process.env.PIKA_CLASSROOM_ASSIGNMENT_DOC_OPEN_ACCESS_PAIRS
  if (!raw || raw.length > 20_000) return null
  try {
    const parsed = assignmentPairsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Dormant exact-pair admission for the learner assignment-document open path only. */
export function resolveContextualAssignmentDocAccess(
  user: AuthenticatedUser,
  assignmentId: string,
): ContextualAssignmentDocAccess {
  if (process.env.PIKA_CLASSROOM_ASSIGNMENT_DOC_OPEN_ACCESS_ENABLED !== 'true') {
    return { mode: 'legacy', user, assignmentId }
  }

  const pairs = configuredAssignmentPairs()
  const identity = canonicalUuid.safeParse(user.id)
  if (pairs === null || !identity.success) {
    throw new ApiError(503, 'Classroom assignment document access configuration is unavailable')
  }

  const requestedId = canonicalUuid.safeParse(assignmentId)
  if (!requestedId.success || !pairs.some((pair) => (
    pair.userId === identity.data && pair.assignmentId === requestedId.data
  ))) {
    return { mode: 'legacy', user, assignmentId }
  }

  return { mode: 'contextual', user, assignmentId: requestedId.data }
}

export function assertContextualAssignmentGitHubIdentity(
  userId: string,
  row: unknown,
): void {
  if (row === null) return
  const requestedUserId = canonicalUuid.safeParse(userId)
  const parsed = githubIdentitySchema.safeParse(row)
  if (
    !requestedUserId.success
    || !parsed.success
    || parsed.data.user_id !== requestedUserId.data
  ) {
    throw new ApiError(503, 'Unable to verify assignment GitHub identity')
  }
}

import { z } from 'zod'

import { ApiError } from '@/lib/api-error'
import { AuthorizationError, requireAuth, requireRole } from '@/lib/auth'
import type { AuthenticatedUser } from '@/types'

export type ContextualAssignmentDocAccess =
  | { mode: 'legacy'; user: AuthenticatedUser; assignmentId: string }
  | { mode: 'contextual'; user: AuthenticatedUser; assignmentId: string }

export type ContextualAssignmentDocSaveAccess = ContextualAssignmentDocAccess
export type ContextualAssignmentDocSubmissionAccess = ContextualAssignmentDocAccess
export type ContextualAssignmentDocHistoryAccess = ContextualAssignmentDocAccess
export type ContextualAssignmentArtifactAccess = ContextualAssignmentDocAccess

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

function configuredSaveAssignmentPairs(): z.infer<typeof assignmentPairsSchema> | null {
  const raw = process.env.PIKA_CLASSROOM_ASSIGNMENT_DOC_SAVE_ACCESS_PAIRS
  if (!raw || raw.length > 20_000) return null
  try {
    const parsed = assignmentPairsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function configuredSubmissionAssignmentPairs(): z.infer<typeof assignmentPairsSchema> | null {
  const raw = process.env.PIKA_CLASSROOM_ASSIGNMENT_DOC_SUBMISSION_ACCESS_PAIRS
  if (!raw || raw.length > 20_000) return null
  try {
    const parsed = assignmentPairsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function configuredHistoryAssignmentPairs(): z.infer<typeof assignmentPairsSchema> | null {
  const raw = process.env.PIKA_CLASSROOM_ASSIGNMENT_DOC_HISTORY_ACCESS_PAIRS
  if (!raw || raw.length > 20_000) return null
  try {
    const parsed = assignmentPairsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function configuredArtifactAssignmentPairs(): z.infer<typeof assignmentPairsSchema> | null {
  const raw = process.env.PIKA_CLASSROOM_ASSIGNMENT_ARTIFACT_ACCESS_PAIRS
  if (!raw || raw.length > 20_000) return null
  try {
    const parsed = assignmentPairsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Dormant exact-pair admission for learner assignment-artifact mutations. */
export async function authorizeContextualAssignmentArtifactRequest(
  assignmentId: string | (() => string | Promise<string>),
): Promise<ContextualAssignmentArtifactAccess> {
  if (process.env.PIKA_CLASSROOM_ASSIGNMENT_ARTIFACT_ACCESS_ENABLED !== 'true') {
    const user = await requireRole('student')
    const resolvedAssignmentId = typeof assignmentId === 'function'
      ? await assignmentId()
      : assignmentId
    return { mode: 'legacy', user, assignmentId: resolvedAssignmentId }
  }

  const user = await requireAuth()
  const pairs = configuredArtifactAssignmentPairs()
  const identity = canonicalUuid.safeParse(user.id)
  if (pairs === null || !identity.success) {
    throw new ApiError(503, 'Classroom assignment attachment configuration is unavailable')
  }

  const rawAssignmentId = typeof assignmentId === 'function'
    ? await assignmentId()
    : assignmentId
  const requestedId = canonicalUuid.safeParse(rawAssignmentId)
  if (!requestedId.success || !pairs.some((pair) => (
    pair.userId === identity.data && pair.assignmentId === requestedId.data
  ))) {
    if (user.role !== 'student') {
      throw new AuthorizationError('Forbidden: student role required')
    }
    return { mode: 'legacy', user, assignmentId: rawAssignmentId }
  }

  return { mode: 'contextual', user, assignmentId: requestedId.data }
}

async function resolveContextualAssignmentDocHistoryAccess(
  assignmentId: string | (() => string | Promise<string>),
  legacyAuth: 'authenticated' | 'student',
): Promise<ContextualAssignmentDocHistoryAccess> {
  if (process.env.PIKA_CLASSROOM_ASSIGNMENT_DOC_HISTORY_ACCESS_ENABLED !== 'true') {
    const user = legacyAuth === 'student' ? await requireRole('student') : await requireAuth()
    const resolvedAssignmentId = typeof assignmentId === 'function'
      ? await assignmentId()
      : assignmentId
    return { mode: 'legacy', user, assignmentId: resolvedAssignmentId }
  }

  const user = await requireAuth()
  const pairs = configuredHistoryAssignmentPairs()
  const identity = canonicalUuid.safeParse(user.id)
  if (pairs === null || !identity.success) {
    throw new ApiError(503, 'Classroom assignment history configuration is unavailable')
  }

  const rawAssignmentId = typeof assignmentId === 'function'
    ? await assignmentId()
    : assignmentId
  const requestedId = canonicalUuid.safeParse(rawAssignmentId)
  if (!requestedId.success || !pairs.some((pair) => (
    pair.userId === identity.data && pair.assignmentId === requestedId.data
  ))) {
    if (legacyAuth === 'student' && user.role !== 'student') {
      throw new AuthorizationError('Forbidden: student role required')
    }
    return { mode: 'legacy', user, assignmentId: rawAssignmentId }
  }

  return { mode: 'contextual', user, assignmentId: requestedId.data }
}

/** Dormant exact-pair admission for assignment-document history reads. */
export function authorizeContextualAssignmentDocHistoryRequest(
  assignmentId: string | (() => string | Promise<string>),
): Promise<ContextualAssignmentDocHistoryAccess> {
  return resolveContextualAssignmentDocHistoryAccess(assignmentId, 'authenticated')
}

/** Dormant exact-pair admission for learner assignment-document restores. */
export function authorizeContextualAssignmentDocRestoreRequest(
  assignmentId: string | (() => string | Promise<string>),
): Promise<ContextualAssignmentDocHistoryAccess> {
  return resolveContextualAssignmentDocHistoryAccess(assignmentId, 'student')
}

/** Dormant exact-pair admission for learner submit and unsubmit routes only. */
export async function authorizeContextualAssignmentDocSubmissionRequest(
  assignmentId: string | (() => string | Promise<string>),
): Promise<ContextualAssignmentDocSubmissionAccess> {
  if (process.env.PIKA_CLASSROOM_ASSIGNMENT_DOC_SUBMISSION_ACCESS_ENABLED !== 'true') {
    const user = await requireRole('student')
    const resolvedAssignmentId = typeof assignmentId === 'function'
      ? await assignmentId()
      : assignmentId
    return { mode: 'legacy', user, assignmentId: resolvedAssignmentId }
  }

  const user = await requireAuth()
  const pairs = configuredSubmissionAssignmentPairs()
  const identity = canonicalUuid.safeParse(user.id)
  if (pairs === null || !identity.success) {
    throw new ApiError(503, 'Classroom assignment submission configuration is unavailable')
  }

  const rawAssignmentId = typeof assignmentId === 'function'
    ? await assignmentId()
    : assignmentId
  const requestedId = canonicalUuid.safeParse(rawAssignmentId)
  if (!requestedId.success || !pairs.some((pair) => (
    pair.userId === identity.data && pair.assignmentId === requestedId.data
  ))) {
    if (user.role !== 'student') {
      throw new AuthorizationError('Forbidden: student role required')
    }
    return { mode: 'legacy', user, assignmentId: rawAssignmentId }
  }

  return { mode: 'contextual', user, assignmentId: requestedId.data }
}

/** Dormant exact-pair admission for the learner assignment-document save path only. */
export async function authorizeContextualAssignmentDocSaveRequest(
  assignmentId: string | (() => string | Promise<string>),
): Promise<ContextualAssignmentDocSaveAccess> {
  if (process.env.PIKA_CLASSROOM_ASSIGNMENT_DOC_SAVE_ACCESS_ENABLED !== 'true') {
    const user = await requireRole('student')
    const resolvedAssignmentId = typeof assignmentId === 'function'
      ? await assignmentId()
      : assignmentId
    return { mode: 'legacy', user, assignmentId: resolvedAssignmentId }
  }

  const user = await requireAuth()
  const pairs = configuredSaveAssignmentPairs()
  const identity = canonicalUuid.safeParse(user.id)
  if (pairs === null || !identity.success) {
    throw new ApiError(503, 'Classroom assignment document save configuration is unavailable')
  }

  const rawAssignmentId = typeof assignmentId === 'function'
    ? await assignmentId()
    : assignmentId
  const requestedId = canonicalUuid.safeParse(rawAssignmentId)
  if (!requestedId.success || !pairs.some((pair) => (
    pair.userId === identity.data && pair.assignmentId === requestedId.data
  ))) {
    if (user.role !== 'student') {
      throw new AuthorizationError('Forbidden: student role required')
    }
    return { mode: 'legacy', user, assignmentId: rawAssignmentId }
  }

  return { mode: 'contextual', user, assignmentId: requestedId.data }
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

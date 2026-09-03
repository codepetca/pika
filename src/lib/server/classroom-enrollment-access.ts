import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { AuthorizationError, requireAuth, requireRole } from '@/lib/auth'
import type { AuthenticatedUser } from '@/types'

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const enrollmentPairsSchema = z.array(z.object({
  userId: canonicalUuid,
  classroomId: canonicalUuid,
}).strict()).max(100)

type EnrollmentPair = z.infer<typeof enrollmentPairsSchema>[number]
const authenticatedEnrollmentEvidence = Symbol('authenticatedEnrollmentEvidence')
type AuthenticatedEnrollmentRequest =
  | { mode: 'legacy'; user: AuthenticatedUser; [authenticatedEnrollmentEvidence]: true }
  | {
    mode: 'contextual_lookup'
    user: AuthenticatedUser
    allowedClassroomIds: string[]
    [authenticatedEnrollmentEvidence]: true
  }

function trustedAuthentication<T extends object>(value: T): T & { [authenticatedEnrollmentEvidence]: true } {
  return Object.defineProperty(value, authenticatedEnrollmentEvidence, { value: true }) as T & {
    [authenticatedEnrollmentEvidence]: true
  }
}

function configuredPairs(): EnrollmentPair[] | null {
  const raw = process.env.PIKA_CLASSROOM_ENROLLMENT_ACCESS_PAIRS
  if (!raw || raw.length > 20_000) return null
  try {
    const parsed = enrollmentPairsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * Authenticate before resolving a code or classroom so an invalid invitation
 * cannot disclose classroom existence. No live route imports this dormant gate.
 */
export async function authenticateClassroomEnrollmentRequest(): Promise<AuthenticatedEnrollmentRequest> {
  if (process.env.PIKA_CLASSROOM_ENROLLMENT_ACCESS_ENABLED !== 'true') {
    return trustedAuthentication({ mode: 'legacy', user: await requireRole('student') })
  }

  const user = await requireAuth()
  const pairs = configuredPairs()
  const identity = canonicalUuid.safeParse(user.id)
  if (pairs === null || !identity.success) {
    throw new ApiError(503, 'Classroom enrollment access configuration is unavailable')
  }

  const allowedClassroomIds = pairs
    .filter((pair) => pair.userId === identity.data)
    .map((pair) => pair.classroomId)
  if (allowedClassroomIds.length > 0) {
    return trustedAuthentication({ mode: 'contextual_lookup', user, allowedClassroomIds })
  }
  if (user.role === 'student') return trustedAuthentication({ mode: 'legacy', user })
  throw new AuthorizationError('Forbidden: student role required')
}

/**
 * Confirm a classroom returned by a pair-scoped invitation lookup. Contextual
 * callers must restrict that lookup to `allowedClassroomIds` before resolving it.
 */
export function selectAuthenticatedClassroomEnrollmentMode(
  authenticated: AuthenticatedEnrollmentRequest,
  classroomId: string,
): { mode: 'legacy' | 'contextual_candidate'; user: AuthenticatedUser } {
  if (authenticated[authenticatedEnrollmentEvidence] !== true) {
    throw new ApiError(503, 'Classroom enrollment authentication evidence is unavailable')
  }
  if (authenticated.mode === 'legacy') return authenticated
  const requestedId = canonicalUuid.safeParse(classroomId)
  if (!requestedId.success) throw new ApiError(400, 'Invalid classroom identifier')

  const admitted = authenticated.allowedClassroomIds.includes(requestedId.data)
  if (admitted) return { mode: 'contextual_candidate', user: authenticated.user }
  throw new AuthorizationError('Forbidden: student role required')
}

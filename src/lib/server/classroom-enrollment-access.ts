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
type AuthenticatedEnrollmentRequest =
  | { mode: 'legacy'; user: AuthenticatedUser }
  | { mode: 'candidate'; user: AuthenticatedUser; identity: string; pairs: EnrollmentPair[] }

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
    return { mode: 'legacy', user: await requireRole('student') }
  }

  const user = await requireAuth()
  const pairs = configuredPairs()
  const identity = canonicalUuid.safeParse(user.id)
  if (pairs === null || !identity.success) {
    throw new ApiError(503, 'Classroom enrollment access configuration is unavailable')
  }
  return { mode: 'candidate', user, identity: identity.data, pairs }
}

/** Select exact user/classroom authority only after authenticated invitation resolution. */
export function selectAuthenticatedClassroomEnrollmentMode(
  authenticated: AuthenticatedEnrollmentRequest,
  classroomId: string,
): { mode: 'legacy' | 'contextual_candidate'; user: AuthenticatedUser } {
  if (authenticated.mode === 'legacy') return authenticated
  const requestedId = canonicalUuid.safeParse(classroomId)
  if (!requestedId.success) throw new ApiError(400, 'Invalid classroom identifier')

  const admitted = authenticated.pairs.some((pair) => (
    pair.userId === authenticated.identity && pair.classroomId === requestedId.data
  ))
  if (admitted) return { mode: 'contextual_candidate', user: authenticated.user }
  if (authenticated.user.role === 'student') return { mode: 'legacy', user: authenticated.user }
  throw new AuthorizationError('Forbidden: student role required')
}

import { z } from 'zod'

import { ApiError } from '@/lib/api-error'
import { AuthorizationError, requireAuth, requireRole } from '@/lib/auth'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import {
  isClassroomExperienceAdmissionConfigured,
  resolveClassroomExperienceAdmission,
} from '@/lib/server/classroom-experience-admission'
import type { AuthenticatedUser } from '@/types'

export type ContextualDailyLogAccess =
  | { mode: 'legacy'; user: AuthenticatedUser; classroomId: string }
  | { mode: 'contextual'; user: AuthenticatedUser; classroomId: string }

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())

/**
 * Dormant shared-admission guard for Daily Log writes. GET uses its separate
 * contextual read adapter. Contextual actors must be active members;
 * an owner relationship always wins over any redundant enrollment row.
 */
export async function authorizeContextualDailyLogRequest(
  classroomId: string | (() => string | Promise<string>),
): Promise<ContextualDailyLogAccess> {
  if (!isClassroomExperienceAdmissionConfigured()) {
    const user = await requireRole('student')
    const resolvedClassroomId = typeof classroomId === 'function'
      ? await classroomId()
      : classroomId
    return { mode: 'legacy', user, classroomId: resolvedClassroomId }
  }

  const user = await requireAuth()
  const admission = resolveClassroomExperienceAdmission(user)
  if (admission.status === 'not-admitted') {
    if (user.role !== 'student') {
      throw new AuthorizationError('Forbidden: student role required')
    }
    const resolvedClassroomId = typeof classroomId === 'function'
      ? await classroomId()
      : classroomId
    return { mode: 'legacy', user, classroomId: resolvedClassroomId }
  }

  const requestedClassroomId = canonicalUuid.safeParse(
    typeof classroomId === 'function' ? await classroomId() : classroomId,
  )
  if (!requestedClassroomId.success) {
    throw new ApiError(400, 'Invalid classroom identifier')
  }

  const actorId = canonicalUuid.safeParse(user.id)
  if (!actorId.success) {
    throw new ApiError(503, 'Classroom experience admission configuration is unavailable')
  }
  const context = await resolveClassroomAccess(actorId.data, requestedClassroomId.data)
  if (context === null) throw new ApiError(404, 'Classroom not found')
  if (context.relationship !== 'member' || context.archived) {
    throw new ApiError(403, 'Forbidden')
  }

  return { mode: 'contextual', user, classroomId: requestedClassroomId.data }
}

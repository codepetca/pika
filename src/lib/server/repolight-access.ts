import { requireAuth, requireRole } from '@/lib/auth'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import type { AuthenticatedUser } from '@/types'

/** Selects the actor only; RepoLight source/run RPCs still prove current ownership. */
export async function requireRepoLightActor(): Promise<AuthenticatedUser> {
  if (isClassroomExperienceAdmissionConfigured()) {
    const user = await requireAuth()
    if (resolveClassroomExperienceAdmission(user).status === 'admitted') return user
  }
  return requireRole('teacher')
}

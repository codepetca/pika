import { z } from 'zod'
import { classroomAccessContextSchema } from './classroom-policy'

const classroomJoinEvidenceSchema = z.object({
  context: classroomAccessContextSchema,
  invitation: z.enum(['code', 'classroom_id']),
  enrollmentOpen: z.boolean(),
  joinPolicy: z.enum(['roster', 'open_join']),
  rosterMatch: z.boolean(),
  profileComplete: z.boolean(),
}).strict()

export type ClassroomJoinDecision =
  | { allowed: true; action: 'join' | 'already_enrolled' }
  | { allowed: false; reason: 'invalid_evidence' | 'archived' | 'own_classroom' | 'code_required' | 'enrollment_closed' | 'not_on_roster' | 'profile_required' }

/**
 * Dormant admission policy only. The caller must authenticate, resolve the
 * invitation, rate-limit guesses and perform all accepted writes atomically.
 */
export function decideClassroomJoin(input: unknown): ClassroomJoinDecision {
  const parsed = classroomJoinEvidenceSchema.safeParse(input)
  if (!parsed.success) return { allowed: false, reason: 'invalid_evidence' }

  const { context, invitation, enrollmentOpen, joinPolicy, rosterMatch, profileComplete } = parsed.data
  if (context.archived) return { allowed: false, reason: 'archived' }
  if (context.relationship === 'owner') return { allowed: false, reason: 'own_classroom' }
  if (context.relationship === 'member') return { allowed: true, action: 'already_enrolled' }
  if (invitation !== 'code') return { allowed: false, reason: 'code_required' }
  if (!enrollmentOpen) return { allowed: false, reason: 'enrollment_closed' }
  if (joinPolicy === 'roster') {
    return rosterMatch ? { allowed: true, action: 'join' } : { allowed: false, reason: 'not_on_roster' }
  }
  return rosterMatch || profileComplete
    ? { allowed: true, action: 'join' }
    : { allowed: false, reason: 'profile_required' }
}

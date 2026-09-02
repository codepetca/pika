import { z } from 'zod'

/**
 * Dormant foundation: existing route guards remain authoritative until migrated.
 * Only construct this from authenticated identity + server-loaded classroom data.
 * Shape validation is NOT proof of identity or membership.
 */
export const classroomAccessContextSchema = z.object({
  userId: z.string().uuid(),
  classroomId: z.string().uuid(),
  ownerId: z.string().uuid(),
  relationship: z.enum(['owner', 'member', 'none']),
  archived: z.boolean(),
}).refine((context) => (context.relationship === 'owner') === (context.userId === context.ownerId))

export type ClassroomAccessContext = z.infer<typeof classroomAccessContextSchema>
export type ClassroomPermission = 'read' | 'manage' | 'participate'

/** Base classroom permission only; resource ownership, visibility and feature gates still apply. */
export function canAccessClassroom(context: unknown, permission: unknown): boolean {
  const parsed = classroomAccessContextSchema.safeParse(context)
  if (!parsed.success) return false
  const { relationship, archived } = parsed.data

  switch (permission) {
    case 'read':
      return relationship === 'owner' || (relationship === 'member' && !archived)
    case 'manage':
      return relationship === 'owner' && !archived
    case 'participate':
      return relationship === 'member' && !archived
    default:
      return false
  }
}

import { z } from 'zod'

const optionalJoinIdentifierSchema = z.string().max(64).nullable().optional()
const optionalProfileFieldSchema = z.string().max(100).nullable().optional()

/**
 * Shared request shape for the legacy and contextual classroom join paths.
 * Extra fields remain ignored for backward compatibility, while every field
 * consumed by either implementation is type- and size-bounded at the boundary.
 */
export const classroomJoinRequestSchema = z.object({
  classCode: optionalJoinIdentifierSchema,
  classroomId: optionalJoinIdentifierSchema,
  firstName: optionalProfileFieldSchema,
  lastName: optionalProfileFieldSchema,
  studentNumber: optionalProfileFieldSchema,
}).passthrough()

export type ClassroomJoinRequest = z.infer<typeof classroomJoinRequestSchema>

import { z } from 'zod'
import { canAccessClassroom, type ClassroomAccessContext } from '@/lib/access/classroom-policy'
import { ApiError } from '@/lib/api-error'
import { AuthorizationError, requireAuth, requireRole } from '@/lib/auth'
import { resolveClassroomAccessFromRecord } from '@/lib/server/classroom-access'
import type { AuthenticatedUser, UserRole } from '@/types'

export type AssignmentDetailAccess =
  | { mode: 'legacy'; user: AuthenticatedUser }
  | { mode: 'contextual'; user: AuthenticatedUser; assignmentId: string }

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true })
const assignmentPairsSchema = z.array(z.object({
  userId: canonicalUuid,
  assignmentId: canonicalUuid,
}).strict()).max(100)
const classroomRowSchema = z.object({
  id: canonicalUuid,
  teacher_id: canonicalUuid,
  archived_at: timestamp.nullable(),
}).passthrough()
const assignmentRowSchema = z.object({
  id: canonicalUuid,
  classroom_id: canonicalUuid,
  classrooms: classroomRowSchema,
}).passthrough()
const enrollmentRowSchema = z.object({
  id: canonicalUuid,
  classroom_id: canonicalUuid,
  student_id: canonicalUuid,
  users: z.object({
    id: canonicalUuid,
    email: z.string().email(),
  }).passthrough(),
}).passthrough()
const profileRowSchema = z.object({
  user_id: canonicalUuid,
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
}).passthrough()
const assignmentDocSchema = z.object({
  id: canonicalUuid,
  assignment_id: canonicalUuid,
  student_id: canonicalUuid,
}).passthrough()
const requirementSchema = z.object({
  id: canonicalUuid,
  assignment_id: canonicalUuid,
}).passthrough()
const artifactSchema = z.object({
  id: canonicalUuid,
  assignment_doc_id: canonicalUuid,
  requirement_id: canonicalUuid,
  student_id: canonicalUuid,
}).passthrough()
const historyRowSchema = z.object({
  assignment_doc_id: canonicalUuid,
  created_at: timestamp,
}).passthrough()
const gradingRunSchema = z.object({
  assignment_id: canonicalUuid,
}).passthrough()

function configuredAssignmentPairs(): z.infer<typeof assignmentPairsSchema> | null {
  const raw = process.env.PIKA_CLASSROOM_ASSIGNMENT_DETAILS_ACCESS_PAIRS
  if (!raw || raw.length > 20_000) return null
  try {
    const parsed = assignmentPairsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Dormant exact-pair admission for assignment-detail reads only. */
export async function authorizeClassroomAssignmentDetailRequest(
  assignmentId: string | null | (() => string | null | Promise<string | null>),
  options: { legacyRole: UserRole },
): Promise<AssignmentDetailAccess> {
  if (process.env.PIKA_CLASSROOM_ASSIGNMENT_DETAILS_ACCESS_ENABLED !== 'true') {
    return { mode: 'legacy', user: await requireRole(options.legacyRole) }
  }

  const user = await requireAuth()
  const pairs = configuredAssignmentPairs()
  const identity = canonicalUuid.safeParse(user.id)
  if (pairs === null || !identity.success) {
    throw new ApiError(503, 'Classroom assignment detail access configuration is unavailable')
  }

  const rawAssignmentId = typeof assignmentId === 'function' ? await assignmentId() : assignmentId
  const requestedId = canonicalUuid.safeParse(rawAssignmentId)
  if (!requestedId.success || !pairs.some((pair) => (
    pair.userId === identity.data && pair.assignmentId === requestedId.data
  ))) {
    if (user.role !== options.legacyRole) {
      throw new AuthorizationError(`Forbidden: ${options.legacyRole} role required`)
    }
    return { mode: 'legacy', user }
  }

  return { mode: 'contextual', user, assignmentId: requestedId.data }
}

/**
 * Resolves a matched detail cohort against the assignment's trusted classroom binding.
 * The assignment record must come from the server-side query for access.assignmentId.
 */
export async function resolveContextualAssignmentDetailAccess(
  access: Extract<AssignmentDetailAccess, { mode: 'contextual' }>,
  assignment: unknown,
  options: { supabase: any },
): Promise<ClassroomAccessContext> {
  const parsed = assignmentRowSchema.safeParse(assignment)
  if (
    !parsed.success
    || parsed.data.id !== access.assignmentId
    || parsed.data.classroom_id !== parsed.data.classrooms.id
  ) {
    throw new ApiError(503, 'Unable to verify assignment detail access')
  }

  const context = await resolveClassroomAccessFromRecord(
    access.user.id,
    parsed.data.classroom_id,
    parsed.data.classrooms,
    { supabase: options.supabase },
  )
  const allowed = context.relationship === 'owner' && canAccessClassroom(context, 'read')
  if (!allowed) throw new ApiError(403, 'Forbidden')
  return context
}

function canonicalSet(values: string[], errorMessage: string): Set<string> {
  const parsed = values.map((value) => canonicalUuid.safeParse(value))
  if (parsed.some((result) => !result.success)) throw new ApiError(503, errorMessage)
  const result = new Set(parsed.map((entry) => entry.data!))
  if (result.size !== values.length) throw new ApiError(503, errorMessage)
  return result
}

export function assertContextualAssignmentDetailEnrollments(
  classroomId: string,
  rows: unknown,
): asserts rows is Array<z.infer<typeof enrollmentRowSchema>> {
  const requestedId = canonicalUuid.safeParse(classroomId)
  const parsed = z.array(enrollmentRowSchema).safeParse(rows)
  if (
    !requestedId.success
    || !parsed.success
    || parsed.data.some((row) => (
      row.classroom_id !== requestedId.data || row.users.id !== row.student_id
    ))
    || new Set(parsed.success ? parsed.data.map((row) => row.student_id) : []).size !== (parsed.success ? parsed.data.length : 0)
  ) {
    throw new ApiError(503, 'Unable to verify assignment detail roster')
  }
}

export function assertContextualAssignmentDetailProfiles(
  studentIds: string[],
  rows: unknown,
): void {
  const students = canonicalSet(studentIds, 'Unable to verify assignment detail profiles')
  const parsed = z.array(profileRowSchema).safeParse(rows)
  if (
    !parsed.success
    || parsed.data.some((row) => !students.has(row.user_id))
    || new Set(parsed.success ? parsed.data.map((row) => row.user_id) : []).size !== (parsed.success ? parsed.data.length : 0)
  ) {
    throw new ApiError(503, 'Unable to verify assignment detail profiles')
  }
}

export function assertContextualAssignmentDetailDocs(
  assignmentId: string,
  studentIds: string[],
  rows: unknown,
): asserts rows is Array<z.infer<typeof assignmentDocSchema>> {
  const requestedId = canonicalUuid.safeParse(assignmentId)
  const students = canonicalSet(studentIds, 'Unable to verify assignment detail documents')
  const parsed = z.array(assignmentDocSchema).safeParse(rows)
  if (
    !requestedId.success
    || !parsed.success
    || parsed.data.some((row) => row.assignment_id !== requestedId.data || !students.has(row.student_id))
    || new Set(parsed.success ? parsed.data.map((row) => row.id) : []).size !== (parsed.success ? parsed.data.length : 0)
    || new Set(parsed.success ? parsed.data.map((row) => row.student_id) : []).size !== (parsed.success ? parsed.data.length : 0)
  ) {
    throw new ApiError(503, 'Unable to verify assignment detail documents')
  }
}

export function assertContextualAssignmentDetailRequirements(
  assignmentId: string,
  rows: unknown,
): void {
  const requestedId = canonicalUuid.safeParse(assignmentId)
  const parsed = z.array(requirementSchema).safeParse(rows)
  if (
    !requestedId.success
    || !parsed.success
    || parsed.data.some((row) => row.assignment_id !== requestedId.data)
    || new Set(parsed.success ? parsed.data.map((row) => row.id) : []).size !== (parsed.success ? parsed.data.length : 0)
  ) {
    throw new ApiError(503, 'Unable to verify assignment detail requirements')
  }
}

export function assertContextualAssignmentDetailArtifacts(
  docs: unknown,
  requirements: unknown,
  rows: unknown,
): void {
  const parsedDocs = z.array(assignmentDocSchema).safeParse(docs)
  const parsedRequirements = z.array(requirementSchema).safeParse(requirements)
  const parsed = z.array(artifactSchema).safeParse(rows)
  if (!parsedDocs.success || !parsedRequirements.success || !parsed.success) {
    throw new ApiError(503, 'Unable to verify assignment detail artifacts')
  }
  const docsById = new Map(parsedDocs.data.map((doc) => [doc.id, doc]))
  const requirementIds = new Set(parsedRequirements.data.map((requirement) => requirement.id))
  if (
    parsed.data.some((artifact) => {
      const doc = docsById.get(artifact.assignment_doc_id)
      return !doc || doc.student_id !== artifact.student_id || !requirementIds.has(artifact.requirement_id)
    })
    || new Set(parsed.data.map((artifact) => artifact.id)).size !== parsed.data.length
  ) {
    throw new ApiError(503, 'Unable to verify assignment detail artifacts')
  }
}

export function assertContextualAssignmentDetailHistory(
  docIds: string[],
  rows: unknown,
): void {
  const documents = canonicalSet(docIds, 'Unable to verify assignment detail history')
  const parsed = z.array(historyRowSchema).safeParse(rows)
  if (!parsed.success || parsed.data.some((row) => !documents.has(row.assignment_doc_id))) {
    throw new ApiError(503, 'Unable to verify assignment detail history')
  }
}

export function assertContextualAssignmentDetailGradingRun(
  assignmentId: string,
  row: unknown,
): void {
  if (row === null) return
  const requestedId = canonicalUuid.safeParse(assignmentId)
  const parsed = gradingRunSchema.safeParse(row)
  if (!requestedId.success || !parsed.success || parsed.data.assignment_id !== requestedId.data) {
    throw new ApiError(503, 'Unable to verify assignment detail grading run')
  }
}

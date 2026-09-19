import { z } from 'zod'
import { canAccessClassroom, type ClassroomAccessContext } from '@/lib/access/classroom-policy'
import { ApiError } from '@/lib/api-error'
import { AuthorizationError, requireAuth, requireRole } from '@/lib/auth'
import { resolveClassroomAccess } from '@/lib/server/classroom-access'
import type { AuthenticatedUser, UserRole } from '@/types'

type AssignmentPermission = 'owner' | 'member'
type AssignmentAccess =
  | { mode: 'legacy'; user: AuthenticatedUser }
  | { mode: 'contextual'; user: AuthenticatedUser; context: ClassroomAccessContext }

const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase())
const assignmentPairsSchema = z.array(z.object({
  userId: canonicalUuid,
  classroomId: canonicalUuid,
}).strict()).max(100)
const assignmentRowSchema = z.object({
  id: canonicalUuid,
  classroom_id: canonicalUuid,
}).passthrough()
const publishedAssignmentRowSchema = assignmentRowSchema.extend({
  is_draft: z.literal(false),
})
const enrollmentRowSchema = z.object({
  classroom_id: canonicalUuid,
  student_id: canonicalUuid,
}).passthrough()
const assignmentStatsDocSchema = z.object({
  assignment_id: canonicalUuid,
  student_id: canonicalUuid,
}).passthrough()
const assignmentRequirementSchema = z.object({
  id: canonicalUuid,
  assignment_id: canonicalUuid,
}).passthrough()
const assignmentDocSchema = z.object({
  id: canonicalUuid,
  assignment_id: canonicalUuid,
  student_id: canonicalUuid,
}).passthrough()

function configuredAssignmentPairs(): z.infer<typeof assignmentPairsSchema> | null {
  const raw = process.env.PIKA_CLASSROOM_ASSIGNMENTS_ACCESS_PAIRS
  if (!raw || raw.length > 20_000) return null
  try {
    const parsed = assignmentPairsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Dormant exact-pair authorization for assignment list reads only. */
export async function authorizeClassroomAssignmentRequest(
  classroomId: string | null | (() => string | null | Promise<string | null>),
  options: { legacyRole: UserRole; permission: AssignmentPermission },
): Promise<AssignmentAccess> {
  if (process.env.PIKA_CLASSROOM_ASSIGNMENTS_ACCESS_ENABLED !== 'true') {
    return { mode: 'legacy', user: await requireRole(options.legacyRole) }
  }

  const user = await requireAuth()
  const pairs = configuredAssignmentPairs()
  const identity = canonicalUuid.safeParse(user.id)
  if (pairs === null || !identity.success) {
    throw new ApiError(503, 'Classroom assignment access configuration is unavailable')
  }

  const rawClassroomId = typeof classroomId === 'function' ? await classroomId() : classroomId
  const requestedId = canonicalUuid.safeParse(rawClassroomId)
  if (!requestedId.success || !pairs.some((pair) => (
    pair.userId === identity.data && pair.classroomId === requestedId.data
  ))) {
    if (user.role !== options.legacyRole) {
      throw new AuthorizationError(`Forbidden: ${options.legacyRole} role required`)
    }
    return { mode: 'legacy', user }
  }

  const context = await resolveClassroomAccess(identity.data, requestedId.data)
  if (context === null) throw new ApiError(404, 'Classroom not found')
  const allowed = options.permission === 'owner'
    ? context.relationship === 'owner' && canAccessClassroom(context, 'read')
    : canAccessClassroom(context, 'participate')
  if (!allowed) throw new ApiError(403, 'Forbidden')
  return { mode: 'contextual', user, context }
}

export function assertContextualAssignmentRows(
  classroomId: string,
  rows: unknown,
  options: { publishedOnly: boolean },
): asserts rows is Array<z.infer<typeof assignmentRowSchema>> {
  const requestedId = canonicalUuid.safeParse(classroomId)
  const parsed = z.array(
    options.publishedOnly ? publishedAssignmentRowSchema : assignmentRowSchema
  ).safeParse(rows)
  if (
    !requestedId.success
    || !parsed.success
    || parsed.data.some((row) => row.classroom_id !== requestedId.data)
  ) {
    throw new ApiError(503, 'Unable to verify classroom assignments')
  }
}

export async function loadContextualClassroomStudentIds(
  supabase: any,
  classroomId: string,
): Promise<{ studentIds: string[]; studentIdSet: Set<string>; totalStudents: number }> {
  const requestedId = canonicalUuid.safeParse(classroomId)
  if (!requestedId.success) throw new ApiError(503, 'Unable to verify classroom roster')

  const pageSize = 1000
  const studentIds = new Set<string>()
  let totalStudents: number | null = null
  let offset = 0

  while (true) {
    let query = supabase
      .from('classroom_enrollments')
      .select('classroom_id, student_id', { count: 'exact' })
      .eq('classroom_id', requestedId.data)
      .order('student_id', { ascending: true })
      .range(offset, offset + pageSize - 1)

    const { data, error, count } = await query
    const parsed = z.array(enrollmentRowSchema).safeParse(data)
    if (
      error
      || !parsed.success
      || parsed.data.some((row) => row.classroom_id !== requestedId.data)
      || (typeof count !== 'number' && count !== null)
    ) {
      throw new ApiError(503, 'Unable to verify classroom roster')
    }

    if (typeof count === 'number') totalStudents = count
    for (const row of parsed.data) studentIds.add(row.student_id)

    if (parsed.data.length < pageSize) break
    if (totalStudents !== null && offset + pageSize >= totalStudents) break
    offset += pageSize
  }

  if (totalStudents !== null && totalStudents !== studentIds.size) {
    throw new ApiError(503, 'Unable to verify classroom roster')
  }
  const sortedStudentIds = Array.from(studentIds)
  return {
    studentIds: sortedStudentIds,
    studentIdSet: new Set(sortedStudentIds),
    totalStudents: totalStudents ?? sortedStudentIds.length,
  }
}

export function assertContextualAssignmentStatsDocs(
  assignmentIds: string[],
  studentIds: string[],
  rows: unknown,
): void {
  const assignments = new Set(assignmentIds.map((id) => canonicalUuid.safeParse(id).data).filter(Boolean))
  const students = new Set(studentIds.map((id) => canonicalUuid.safeParse(id).data).filter(Boolean))
  const parsed = z.array(assignmentStatsDocSchema).safeParse(rows)
  if (
    assignments.size !== assignmentIds.length
    || students.size !== studentIds.length
    || !parsed.success
    || parsed.data.some((row) => !assignments.has(row.assignment_id) || !students.has(row.student_id))
  ) {
    throw new ApiError(503, 'Unable to verify assignment statistics')
  }
}

export function assertContextualAssignmentRequirements(
  assignmentId: string,
  rows: unknown,
): void {
  const requestedId = canonicalUuid.safeParse(assignmentId)
  const parsed = z.array(assignmentRequirementSchema).safeParse(rows)
  if (
    !requestedId.success
    || !parsed.success
    || parsed.data.some((row) => row.assignment_id !== requestedId.data)
  ) {
    throw new ApiError(503, 'Unable to verify assignment submission requirements')
  }
}

export function assertContextualStudentAssignmentDocs(
  userId: string,
  assignmentIds: string[],
  rows: unknown,
): void {
  const identity = canonicalUuid.safeParse(userId)
  const assignments = new Set(assignmentIds.map((id) => canonicalUuid.safeParse(id).data).filter(Boolean))
  const parsed = z.array(assignmentDocSchema).safeParse(rows)
  if (
    !identity.success
    || assignments.size !== assignmentIds.length
    || !parsed.success
    || parsed.data.some((row) => (
      row.student_id !== identity.data || !assignments.has(row.assignment_id)
    ))
  ) {
    throw new ApiError(503, 'Unable to verify student assignment documents')
  }
}

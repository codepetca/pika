import { z } from 'zod'
import { ApiError } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { liveCleanupTargetSchema } from '@/lib/validations/live-student-cleanup'

const discoveryTargetSchema = liveCleanupTargetSchema.extend({
  operation_id: z.string().uuid().nullable(), operation_status: z.literal('provider_pending').nullable(),
}).strict().refine(target => (target.operation_id === null) === (target.operation_status === null))
const discoveryPageSchema = z.object({
  schema_version: z.literal(1), teacher_id: z.string().uuid(), classroom_id: z.string().uuid(),
  student_id: z.string().uuid().nullable(), after_student_id: z.string().uuid().nullable(),
  include_unreserved: z.boolean(), targets: discoveryTargetSchema.array().max(100),
  target_count: z.number().int().min(0).max(100), next_student_id: z.string().uuid().nullable(),
  snapshot_sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

// Feature-owned transport until the coordinator generates the genuine DB types.
interface DiscoveryClient {
  rpc(name: 'discover_retained_student_cleanup_groups', args: {
    p_teacher_id: string; p_classroom_id: string; p_student_id: string | null;
    p_after_student_id: string | null; p_include_unreserved: boolean;
    p_snapshot_sha256: string | null;
  }): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
}

/** Every page, including an empty terminal page, reauthorizes current ownership.
 * A failed page invalidates the whole projection; it never returns a partial list.
 */
export async function discoverRetainedStudentCleanupGroups(
  teacherId: string, classroomId: string, includeUnreserved: boolean, studentId: string | null = null,
) {
  // PostgreSQL UUID transport is canonical lowercase, including route UUIDs
  // supplied in a valid uppercase spelling.
  teacherId = teacherId.toLowerCase()
  classroomId = classroomId.toLowerCase()
  studentId = studentId?.toLowerCase() ?? null
  const client = getServiceRoleClient() as unknown as DiscoveryClient
  const targets: z.infer<typeof discoveryTargetSchema>[] = []
  const generations = new Set<string>()
  const operations = new Set<string>()
  let cursor: string | null = null
  let snapshot: string | null = null
  do {
    let response
    try {
      response = await client.rpc('discover_retained_student_cleanup_groups', {
        p_teacher_id: teacherId, p_classroom_id: classroomId, p_student_id: studentId,
        p_after_student_id: cursor, p_include_unreserved: includeUnreserved,
        p_snapshot_sha256: snapshot,
      })
    } catch {
      throw new ApiError(503, 'Classroom cleanup is unavailable')
    }
    if (response?.error) {
      if (response.error.code === '42501') throw new ApiError(403, 'Classroom cleanup is not permitted')
      if (response.error.code === '55000' && response.error.message === 'retained_roster_cleanup_group_invalid')
        throw new ApiError(409, 'An exact removed membership is required')
      throw new ApiError(503, 'Classroom cleanup is unavailable')
    }
    const decoded = discoveryPageSchema.safeParse(response?.data)
    if (!decoded.success) throw new ApiError(503, 'Classroom cleanup is unavailable')
    const page = decoded.data
    if (page.teacher_id !== teacherId || page.classroom_id !== classroomId || page.student_id !== studentId
      || page.after_student_id !== cursor || page.include_unreserved !== includeUnreserved
      || page.target_count !== page.targets.length
      || (snapshot !== null && page.snapshot_sha256 !== snapshot)
      || (studentId !== null && (page.targets.length > 1 || page.next_student_id !== null))
      || (page.next_student_id !== null && (page.targets.length !== 100
        || page.next_student_id !== page.targets.at(-1)?.student_id)))
      throw new ApiError(503, 'Classroom cleanup is unavailable')
    let previous = cursor
    for (const target of page.targets) {
      if (target.student_id === teacherId
        || (studentId !== null && target.student_id !== studentId)
        || (previous !== null && target.student_id <= previous)
        || generations.has(target.generation_id)
        || (target.operation_id !== null && operations.has(target.operation_id))
        || (studentId === null && !includeUnreserved && target.operation_id === null))
        throw new ApiError(503, 'Classroom cleanup is unavailable')
      previous = target.student_id
      generations.add(target.generation_id)
      if (target.operation_id !== null) operations.add(target.operation_id)
      targets.push(target)
    }
    cursor = page.next_student_id
    snapshot = page.snapshot_sha256
  } while (cursor !== null)
  return targets
}

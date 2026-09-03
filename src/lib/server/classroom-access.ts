import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { getServiceRoleClient } from '@/lib/supabase'
import type { ClassroomAccessContext } from '@/lib/access/classroom-policy'
import type { TableRow } from '@/types/database'

type ClassroomRow = Pick<TableRow<'classrooms'>, 'id' | 'teacher_id' | 'archived_at'>
type EnrollmentRow = Pick<TableRow<'classroom_enrollments'>, 'classroom_id' | 'student_id'>
const uuid = z.string().uuid()
export const classroomAccessRowSchema: z.ZodType<ClassroomRow> = z.object({
  id: uuid, teacher_id: uuid, archived_at: z.string().datetime({ offset: true }).nullable(),
})
const enrollmentSchema: z.ZodType<EnrollmentRow> = z.object({ classroom_id: uuid, student_id: uuid })

/**
 * Dormant, read-only relationship resolver. Does not authenticate or authorize.
 * userId MUST come from the server session, never a request body or query string.
 * Callers must evaluate permission before returning even this context to a client.
 * Existing live guards are deliberately unchanged during the compatibility phase.
 * A missing classroom is null; database failures reject and must never be allowed.
 */
export async function resolveClassroomAccess(
  userId: string,
  classroomId: string,
  options: { supabase?: ReturnType<typeof getServiceRoleClient> } = {},
): Promise<ClassroomAccessContext | null> {
  if (!uuid.safeParse(userId).success || !uuid.safeParse(classroomId).success) {
    throw new ApiError(400, 'Invalid classroom access identifiers')
  }
  const supabase = options.supabase ?? getServiceRoleClient()
  const { data, error } = await supabase.from('classrooms')
    .select('id, teacher_id, archived_at').eq('id', classroomId).maybeSingle()
  if (error) throw new ApiError(503, 'Unable to resolve classroom access')
  if (data === null) return null
  const classroom = classroomAccessRowSchema.safeParse(data)
  if (!classroom.success || classroom.data.id !== classroomId) {
    throw new ApiError(503, 'Unable to resolve classroom access')
  }

  const base = {
    userId, classroomId, ownerId: classroom.data.teacher_id,
    archived: classroom.data.archived_at !== null,
  }
  if (base.ownerId === userId) return { ...base, relationship: 'owner' }

  const { data: enrollmentData, error: enrollmentError } = await supabase.from('classroom_enrollments')
    .select('classroom_id, student_id').eq('classroom_id', classroomId).eq('student_id', userId).maybeSingle()
  if (enrollmentError) throw new ApiError(503, 'Unable to resolve classroom access')
  if (enrollmentData === null) return { ...base, relationship: 'none' }
  const enrollment = enrollmentSchema.safeParse(enrollmentData)
  if (!enrollment.success || enrollment.data.classroom_id !== classroomId || enrollment.data.student_id !== userId) {
    throw new ApiError(503, 'Unable to resolve classroom access')
  }
  return { ...base, relationship: 'member' }
}

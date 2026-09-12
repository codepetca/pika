import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { getServiceRoleClient } from '@/lib/supabase'

export const classroomStudentRemovalRequestSchema = z.object({
  roster_ids: z.array(z.string().uuid()).min(1).max(100),
}).strict()

const resultSchema = z.object({
  requested_count: z.number().int().nonnegative(),
  removed_count: z.number().int().nonnegative(),
})

export async function removeClassroomStudents(teacherId: string, classroomId: string, rosterIds: string[]) {
  // Never fall back to the legacy destructive removal RPC.
  const client = getServiceRoleClient()
  const { data, error } = await client.rpc('remove_classroom_students_preserving_data', {
    p_teacher_id: teacherId, p_classroom_id: classroomId,
    p_roster_ids: [...new Set(rosterIds)],
  })
  if (error) {
    if (['42883', 'PGRST202'].includes(error.code ?? '')) {
      throw new ApiError(503, 'Class removal is not available yet. No student data was deleted.')
    }
    if (error.code === '42501') throw new ApiError(403, 'You cannot remove students from this class.')
    if (error.code === '22023') throw new ApiError(409, 'The roster changed. Refresh it and try again.')
    if (['40001', '40P01', '55P03'].includes(error.code ?? '')) {
      throw new ApiError(409, 'This class is busy. Please try removing the student again in a moment.')
    }
    if (error.code === '55000') throw new ApiError(409, 'Class removal is unavailable while another classroom operation is active.')
    throw new ApiError(500, 'Could not remove students from this class. Please try again.')
  }
  return resultSchema.parse(data)
}

const removedStudentMessage = 'A removed student cannot be re-added to this class until their old class data has been permanently deleted. No students were added.'
const retainedRosterSchema = z.array(z.object({
  email: z.string(),
  student: z.object({ email: z.string() }),
}))

/** Read-only UX preflight. Migration 165 also rejects races at the write boundary. */
export async function assertStudentsCanBeAddedToRoster(classroomId: string, emails: string[]) {
  const client = getServiceRoleClient()
  const requested = new Set(emails.map((email) => email.trim().toLowerCase()))
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from('classroom_roster')
      .select('email, student:users!classroom_roster_removed_student_id_fkey(email)')
      .eq('classroom_id', classroomId)
      .not('removed_at', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    const parsed = retainedRosterSchema.safeParse(data)
    if (error || !parsed.success) {
      throw new ApiError(503, 'Could not check whether these students can be added. No students were added. Please try again.')
    }
    if (parsed.data.some((row) => requested.has(row.email.trim().toLowerCase())
      || requested.has(row.student.email.trim().toLowerCase()))) {
      throw new ApiError(409, removedStudentMessage)
    }
    if (parsed.data.length < pageSize) return
  }
}

export function throwIfRemovedStudentRosterError(error: { code?: string; message?: string }) {
  if (error.code === '55000' && error.message === 'student_class_data_pending_purge') {
    throw new ApiError(409, removedStudentMessage)
  }
}

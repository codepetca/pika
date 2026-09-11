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
  // Narrow compatibility boundary until the forward migration is reflected in
  // generated types. Never fall back to the legacy destructive removal RPC.
  const client = getServiceRoleClient() as unknown as {
    rpc(name: string, args: Record<string, unknown>): PromiseLike<{
      data: unknown; error: { code?: string; message?: string } | null
    }>
  }
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

/** Explicit teacher re-addition restores retained membership, never erases data. */
export async function restoreRemovedClassroomStudents(teacherId: string, classroomId: string, emails: string[]) {
  const client = getServiceRoleClient() as unknown as {
    rpc(name: string, args: Record<string, unknown>): PromiseLike<{
      data: unknown; error: { code?: string; message?: string } | null
    }>
  }
  const normalized = [...new Set(emails.map((email) => email.trim().toLowerCase()))]
  let restored = 0
  for (let offset = 0; offset < normalized.length; offset += 100) {
    const { data, error } = await client.rpc('restore_removed_classroom_students', {
      p_teacher_id: teacherId, p_classroom_id: classroomId, p_emails: normalized.slice(offset, offset + 100),
    })
    // No retained memberships can exist before this migration. Preserve the
    // existing add/import workflow during the application/schema rollout window.
    if (error && ['42883', 'PGRST202'].includes(error.code ?? '')) return restored
    if (error) throw new ApiError(409, 'Roster details were saved, but class access could not be restored. Please try adding the student again.')
    restored += z.object({ restored_count: z.number().int().nonnegative() }).parse(data).restored_count
  }
  return restored
}

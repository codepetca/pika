import { ApiError, apiErrors } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import type { Assignment } from '@/types'

export { isAssignmentVisibleToStudents } from '@/lib/assignments'

type SupabaseClient = ReturnType<typeof getServiceRoleClient>
type AssignmentWithClassroom = Assignment & {
  classrooms: {
    id: string
    title: string
    teacher_id: string
    archived_at: string | null
  }
}

export async function loadTeacherOwnedAssignment(opts: {
  supabase: SupabaseClient
  assignmentId: string
  teacherId: string
  allowArchived?: boolean
}): Promise<AssignmentWithClassroom> {
  const { supabase, assignmentId, teacherId, allowArchived = false } = opts
  const { data: assignment, error: assignmentError } = await supabase
    .from('assignments')
    .select(`
      *,
      classrooms!inner (
        id,
        title,
        teacher_id,
        archived_at
      )
    `)
    .eq('id', assignmentId)
    .single()

  if (assignmentError || !assignment) {
    throw apiErrors.notFound('Assignment not found')
  }

  if (assignment.classrooms.teacher_id !== teacherId) {
    throw new ApiError(403, 'Unauthorized')
  }

  if (!allowArchived && assignment.classrooms.archived_at) {
    throw new ApiError(403, 'Classroom is archived')
  }

  return assignment as AssignmentWithClassroom
}

export async function assertTeacherOwnsAssignment(
  teacherId: string,
  assignmentId: string,
): Promise<AssignmentWithClassroom> {
  return loadTeacherOwnedAssignment({
    supabase: getServiceRoleClient(),
    assignmentId,
    teacherId,
    allowArchived: true,
  })
}

export async function assertTeacherCanMutateAssignment(
  teacherId: string,
  assignmentId: string,
): Promise<AssignmentWithClassroom> {
  return loadTeacherOwnedAssignment({
    supabase: getServiceRoleClient(),
    assignmentId,
    teacherId,
  })
}

export function isMissingAssignmentTeacherClearedAtColumnError(error: {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
} | null | undefined): boolean {
  if (!error) return false
  const combined = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase()
  if (!combined.includes('teacher_cleared_at')) return false
  return error.code === '42703' || error.code === 'PGRST204' || combined.includes('column')
}

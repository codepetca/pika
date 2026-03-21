import { getServiceRoleClient } from '@/lib/supabase'
import { ApiError, apiErrors } from '@/lib/api-handler'
import type { Assignment } from '@/types'

type AssignmentWithClassroom = Assignment & {
  classrooms: {
    id: string
    title: string
    teacher_id: string
    archived_at: string | null
  }
}

export async function assertTeacherOwnsAssignment(teacherId: string, assignmentId: string): Promise<AssignmentWithClassroom> {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase
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

  if (error || !data) {
    throw apiErrors.notFound('Assignment not found')
  }

  if (data.classrooms.teacher_id !== teacherId) {
    throw new ApiError(403, 'Unauthorized')
  }

  return data as AssignmentWithClassroom
}

import { ApiError, apiErrors } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import type { ParsedAssignmentGradePayload } from '@/lib/validations/assignment-grading'
import type { TableInsert } from '@/types/database'

type SupabaseClient = ReturnType<typeof getServiceRoleClient>

export async function loadTeacherOwnedAssignmentForGrade(opts: {
  supabase: SupabaseClient
  assignmentId: string
  teacherId: string
}) {
  const { supabase, assignmentId, teacherId } = opts
  const { data: assignment, error: assignmentError } = await supabase
    .from('assignments')
    .select(`
      *,
      classrooms!inner (
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

  if (assignment.classrooms.archived_at) {
    throw new ApiError(403, 'Classroom is archived')
  }

  return assignment
}

export async function assertStudentsEnrolledForAssignmentGrade(opts: {
  supabase: SupabaseClient
  classroomId: string
  studentIds: string[]
}) {
  const { supabase, classroomId, studentIds } = opts

  if (studentIds.length === 1) {
    const { data: enrollment, error } = await supabase
      .from('classroom_enrollments')
      .select('id')
      .eq('classroom_id', classroomId)
      .eq('student_id', studentIds[0])
      .maybeSingle()

    if (error) {
      throw new Error('Failed to validate student enrollment')
    }
    if (!enrollment) {
      throw apiErrors.badRequest('Student is not enrolled in this classroom')
    }
    return
  }

  const { data: enrollments, error } = await supabase
    .from('classroom_enrollments')
    .select('student_id')
    .eq('classroom_id', classroomId)
    .in('student_id', studentIds)

  if (error) {
    throw new Error('Failed to validate student enrollment')
  }

  if (((enrollments as Array<{ student_id: string }> | null) ?? []).length !== studentIds.length) {
    throw apiErrors.badRequest('Student is not enrolled in this classroom')
  }
}

export function buildAssignmentGradeRows(opts: {
  assignmentId: string
  studentIds: string[]
  grade: ParsedAssignmentGradePayload
  now: string
}): TableInsert<'assignment_docs'>[] {
  const { assignmentId, studentIds, grade, now } = opts

  const shouldApplyGrade = grade.apply_target === 'grade' || grade.apply_target === 'grade-and-comments'
  const shouldApplyComments = grade.apply_target === 'comments' || grade.apply_target === 'grade-and-comments'

  return studentIds.map((studentId) => {
    const row: TableInsert<'assignment_docs'> = {
      assignment_id: assignmentId,
      student_id: studentId,
    }

    if (shouldApplyGrade) {
      row.score_completion = grade.score_completion
      row.score_thinking = grade.score_thinking
      row.score_workflow = grade.score_workflow
      row.graded_at = grade.shouldMarkGraded ? now : null
      row.graded_by = grade.shouldMarkGraded ? 'teacher' : null
    }

    if (shouldApplyComments) {
      row.teacher_feedback_draft = grade.feedback
      row.teacher_feedback_draft_updated_at = now
      row.ai_feedback_suggestion = null
      row.ai_feedback_suggested_at = null
      row.ai_feedback_model = null
    }

    return row
  })
}

export async function upsertAssignmentGradeRows(opts: {
  supabase: SupabaseClient
  assignmentId: string
  studentIds: string[]
  grade: ParsedAssignmentGradePayload
}) {
  const { supabase, assignmentId, studentIds, grade } = opts
  const now = new Date().toISOString()
  const rows = buildAssignmentGradeRows({
    assignmentId,
    studentIds,
    grade,
    now,
  })

  return supabase
    .from('assignment_docs')
    .upsert(rows, { onConflict: 'assignment_id,student_id' })
    .select()
}

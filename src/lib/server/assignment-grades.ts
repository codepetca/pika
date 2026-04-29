import { ApiError, apiErrors } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'

export type AssignmentGradeSaveMode = 'draft' | 'graded'

export interface ParsedAssignmentGradePayload {
  score_completion: number | null
  score_thinking: number | null
  score_workflow: number | null
  feedback: string
  save_mode: AssignmentGradeSaveMode
  shouldMarkGraded: boolean
}

interface AssignmentGradeBody {
  score_completion: unknown
  score_thinking: unknown
  score_workflow: unknown
  feedback: unknown
  save_mode?: unknown
}

type SupabaseClient = ReturnType<typeof getServiceRoleClient>

function parseDraftScore(value: unknown): number | null | typeof Number.NaN {
  if (value === '' || value === null || value === undefined) return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10) return Number.NaN
  return parsed
}

export function normalizeAssignmentGradeStudentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return Array.from(
    new Set(value.filter((studentId): studentId is string => typeof studentId === 'string')),
  )
}

export function parseAssignmentGradePayload(body: AssignmentGradeBody): ParsedAssignmentGradePayload {
  const {
    score_completion,
    score_thinking,
    score_workflow,
    feedback,
    save_mode,
  } = body

  if (typeof feedback !== 'string') {
    throw apiErrors.badRequest('feedback must be a string')
  }

  if (save_mode !== undefined && save_mode !== 'draft' && save_mode !== 'graded') {
    throw apiErrors.badRequest('save_mode must be "draft" or "graded"')
  }

  const selectedSaveMode: AssignmentGradeSaveMode = save_mode === 'draft' ? 'draft' : 'graded'
  const shouldMarkGraded = selectedSaveMode === 'graded'
  const parsedScores = {
    score_completion: shouldMarkGraded ? Number(score_completion) : parseDraftScore(score_completion),
    score_thinking: shouldMarkGraded ? Number(score_thinking) : parseDraftScore(score_thinking),
    score_workflow: shouldMarkGraded ? Number(score_workflow) : parseDraftScore(score_workflow),
  }

  for (const [name, value] of Object.entries(parsedScores)) {
    if (shouldMarkGraded) {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10) {
        throw apiErrors.badRequest(`${name} must be an integer 0–10`)
      }
      continue
    }

    if (Number.isNaN(value)) {
      throw apiErrors.badRequest(`${name} must be blank or an integer 0–10`)
    }
  }

  return {
    ...parsedScores,
    feedback,
    save_mode: selectedSaveMode,
    shouldMarkGraded,
  }
}

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
        teacher_id
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
}) {
  const { assignmentId, studentIds, grade, now } = opts

  return studentIds.map((studentId) => ({
    assignment_id: assignmentId,
    student_id: studentId,
    score_completion: grade.score_completion,
    score_thinking: grade.score_thinking,
    score_workflow: grade.score_workflow,
    teacher_feedback_draft: grade.feedback,
    teacher_feedback_draft_updated_at: now,
    graded_at: grade.shouldMarkGraded ? now : null,
    graded_by: grade.shouldMarkGraded ? 'teacher' : null,
  }))
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

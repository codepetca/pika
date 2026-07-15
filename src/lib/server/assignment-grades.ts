import { ApiError, apiErrors } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import type { ParsedAssignmentGradePayload } from '@/lib/validations/assignment-grading'
import { assignmentGradeSaveResultSchema } from '@/lib/validations/assignment-grading'
import type { Json } from '@/types/database.generated'

type SupabaseClient = ReturnType<typeof getServiceRoleClient>

function toJson(value: unknown): Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ApiError(500, 'Assignment grading payload contains a non-finite number')
    }
    return value
  }
  if (Array.isArray(value)) {
    return value.map(toJson)
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, toJson(nested)]),
    )
  }
  throw new ApiError(500, 'Assignment grading payload is not JSON serializable')
}

export interface AssignmentAiGradeInput {
  studentId: string
  expectedDocUpdatedAt: string | null
  scoreCompletion: number
  scoreThinking: number
  scoreWorkflow: number
  feedback: string
  applyTeacherFeedbackDraft?: boolean
  markGraded?: boolean
  aiFeedbackSuggestion: string | null
  aiFeedbackModel: string | null
  gradedBy?: string | null
}

function throwAssignmentGradeRpcError(error: { code?: string; message: string }, fallback: string): never {
  if (error.code === '42501') {
    throw new ApiError(403, error.message)
  }
  if (error.code === '40001') {
    throw apiErrors.conflict('Assignment grade changed; reload and retry')
  }
  if (error.code === '22023') {
    throw apiErrors.badRequest(error.message)
  }
  throw new ApiError(500, fallback)
}

export async function saveAssignmentGradesAtomic(opts: {
  supabase: SupabaseClient
  assignmentId: string
  teacherId: string
  studentIds: string[]
  expectedDocUpdatedAtByStudent: Record<string, string | null>
  grade: ParsedAssignmentGradePayload
}) {
  const {
    supabase,
    assignmentId,
    teacherId,
    studentIds,
    expectedDocUpdatedAtByStudent,
    grade,
  } = opts
  const applyGrade = grade.apply_target === 'grade' || grade.apply_target === 'grade-and-comments'
  const applyComments = grade.apply_target === 'comments' || grade.apply_target === 'grade-and-comments'
  const resolvedExpectedDocUpdatedAtByStudent = { ...expectedDocUpdatedAtByStudent }
  const missingRevisionStudentIds = studentIds.filter(
    (studentId) => !Object.prototype.hasOwnProperty.call(resolvedExpectedDocUpdatedAtByStudent, studentId),
  )

  if (missingRevisionStudentIds.length > 0) {
    throw apiErrors.conflict('Assignment grade revision is required; reload and retry')
  }

  const { data, error } = await supabase.rpc('save_assignment_grades_atomic', {
    p_assignment_id: assignmentId,
    p_student_ids: studentIds,
    p_teacher_id: teacherId,
    p_expected_doc_updated_at_by_student: resolvedExpectedDocUpdatedAtByStudent,
    p_apply_grade: applyGrade,
    p_score_completion: grade.score_completion,
    p_score_thinking: grade.score_thinking,
    p_score_workflow: grade.score_workflow,
    p_mark_graded: grade.shouldMarkGraded,
    p_apply_comments: applyComments,
    p_feedback: grade.feedback,
    p_now: new Date().toISOString(),
  })

  if (error) {
    if (error.code === '42501') {
      throw new ApiError(403, error.message)
    }
    if (error.code === '40001') {
      throw apiErrors.conflict('Assignment grade changed; reload and retry')
    }
    if (error.code === '22023') {
      throw apiErrors.badRequest(error.message)
    }
    throw new ApiError(500, 'Failed to save assignment grade')
  }

  const parsed = assignmentGradeSaveResultSchema.safeParse(data)
  if (!parsed.success || parsed.data.docs.length !== studentIds.length) {
    throw new ApiError(500, 'Invalid assignment grade save result')
  }

  return parsed.data.docs
}

export async function saveAssignmentAiGradeAtomic(opts: {
  supabase: SupabaseClient
  assignmentId: string
  studentId: string
  teacherId: string
  expectedDocUpdatedAt: string | null
  scoreCompletion: number
  scoreThinking: number
  scoreWorkflow: number
  feedback: string
  applyTeacherFeedbackDraft?: boolean
  markGraded?: boolean
  aiFeedbackSuggestion: string | null
  aiFeedbackModel: string | null
  gradedBy?: string | null
  now?: string
}) {
  const { data, error } = await opts.supabase.rpc('save_assignment_ai_grade_atomic', {
    p_assignment_id: opts.assignmentId,
    p_student_id: opts.studentId,
    p_teacher_id: opts.teacherId,
    p_expected_doc_updated_at: opts.expectedDocUpdatedAt,
    p_score_completion: opts.scoreCompletion,
    p_score_thinking: opts.scoreThinking,
    p_score_workflow: opts.scoreWorkflow,
    p_feedback: opts.feedback,
    p_apply_teacher_feedback_draft: opts.applyTeacherFeedbackDraft ?? true,
    p_mark_graded: opts.markGraded ?? true,
    p_ai_feedback_suggestion: opts.aiFeedbackSuggestion,
    p_ai_feedback_model: opts.aiFeedbackModel,
    p_graded_by: opts.gradedBy ?? null,
    p_now: opts.now ?? new Date().toISOString(),
  })

  if (error) {
    if (error.code === '42501') {
      throw new ApiError(403, error.message)
    }
    if (error.code === '40001') {
      throw apiErrors.conflict('Assignment grade changed; reload and retry')
    }
    if (error.code === '22023') {
      throw apiErrors.badRequest(error.message)
    }
    throw new ApiError(500, 'Failed to save AI assignment grade')
  }

  const parsed = assignmentGradeSaveResultSchema.safeParse(data)
  if (!parsed.success || parsed.data.docs.length !== 1) {
    throw new ApiError(500, 'Invalid AI assignment grade save result')
  }

  return parsed.data.docs[0]
}

export async function finalizeAssignmentAiGradingItemAtomic(opts: {
  supabase: SupabaseClient
  itemId: string
  teacherId: string
  grade: Omit<AssignmentAiGradeInput, 'studentId' | 'expectedDocUpdatedAt'>
  attemptCount: number
  itemStatus: 'completed' | 'skipped'
  skipReason?: 'missing_doc' | 'empty_doc' | null
  now?: string
}) {
  const { data, error } = await opts.supabase.rpc('finalize_assignment_ai_grading_item_atomic', {
    p_item_id: opts.itemId,
    p_teacher_id: opts.teacherId,
    p_score_completion: opts.grade.scoreCompletion,
    p_score_thinking: opts.grade.scoreThinking,
    p_score_workflow: opts.grade.scoreWorkflow,
    p_feedback: opts.grade.feedback,
    p_apply_teacher_feedback_draft: opts.grade.applyTeacherFeedbackDraft ?? true,
    p_mark_graded: opts.grade.markGraded ?? true,
    p_ai_feedback_suggestion: opts.grade.aiFeedbackSuggestion,
    p_ai_feedback_model: opts.grade.aiFeedbackModel,
    p_graded_by: opts.grade.gradedBy ?? null,
    p_attempt_count: opts.attemptCount,
    p_item_status: opts.itemStatus,
    p_skip_reason: opts.skipReason ?? null,
    p_now: opts.now ?? new Date().toISOString(),
  })

  if (error) {
    throwAssignmentGradeRpcError(error, 'Failed to finalize AI assignment grade')
  }

  const parsed = assignmentGradeSaveResultSchema.safeParse(data)
  if (!parsed.success || parsed.data.docs.length !== 1) {
    throw new ApiError(500, 'Invalid AI assignment grade finalization result')
  }

  return parsed.data.docs[0]
}

export async function saveAssignmentAiGradesAtomic(opts: {
  supabase: SupabaseClient
  assignmentId: string
  teacherId: string
  grades: AssignmentAiGradeInput[]
  now?: string
}) {
  const now = opts.now ?? new Date().toISOString()
  const { data, error } = await opts.supabase.rpc('save_assignment_ai_grades_atomic', {
    p_assignment_id: opts.assignmentId,
    p_teacher_id: opts.teacherId,
    p_grade_rows: opts.grades.map((grade) => ({
      student_id: grade.studentId,
      expected_doc_updated_at: grade.expectedDocUpdatedAt,
      score_completion: grade.scoreCompletion,
      score_thinking: grade.scoreThinking,
      score_workflow: grade.scoreWorkflow,
      feedback: grade.feedback,
      apply_teacher_feedback_draft: grade.applyTeacherFeedbackDraft ?? true,
      mark_graded: grade.markGraded ?? true,
      ai_feedback_suggestion: grade.aiFeedbackSuggestion,
      ai_feedback_model: grade.aiFeedbackModel,
      graded_by: grade.gradedBy ?? null,
    })),
    p_now: now,
  })

  if (error) {
    if (error.code === '42501') {
      throw new ApiError(403, error.message)
    }
    if (error.code === '40001') {
      throw apiErrors.conflict('Assignment grade changed; reload and retry')
    }
    if (error.code === '22023') {
      throw apiErrors.badRequest(error.message)
    }
    throw new ApiError(500, 'Failed to save AI assignment grades')
  }

  const parsed = assignmentGradeSaveResultSchema.safeParse(data)
  if (!parsed.success || parsed.data.docs.length !== opts.grades.length) {
    throw new ApiError(500, 'Invalid AI assignment grade batch result')
  }

  return parsed.data.docs
}

export async function completeAssignmentRepoReviewRunAtomic(opts: {
  supabase: SupabaseClient
  runId: string
  teacherId: string
  results: unknown[]
  grades: AssignmentAiGradeInput[]
  sourceRef: string
  model: string
  warnings: unknown
  now?: string
}) {
  const now = opts.now ?? new Date().toISOString()
  const { data, error } = await opts.supabase.rpc('complete_assignment_repo_review_run_atomic', {
    p_run_id: opts.runId,
    p_teacher_id: opts.teacherId,
    p_result_rows: toJson(opts.results),
    p_grade_rows: opts.grades.map((grade) => ({
      student_id: grade.studentId,
      expected_doc_updated_at: grade.expectedDocUpdatedAt,
      score_completion: grade.scoreCompletion,
      score_thinking: grade.scoreThinking,
      score_workflow: grade.scoreWorkflow,
      feedback: grade.feedback,
      apply_teacher_feedback_draft: grade.applyTeacherFeedbackDraft ?? true,
      mark_graded: grade.markGraded ?? true,
      ai_feedback_suggestion: grade.aiFeedbackSuggestion,
      ai_feedback_model: grade.aiFeedbackModel,
      graded_by: grade.gradedBy ?? null,
    })),
    p_source_ref: opts.sourceRef,
    p_model: opts.model,
    p_warnings: toJson(opts.warnings),
    p_now: now,
  })

  if (error) {
    throwAssignmentGradeRpcError(error, 'Failed to complete assignment repo review')
  }

  const parsed = assignmentGradeSaveResultSchema.safeParse(data)
  if (!parsed.success || parsed.data.docs.length !== opts.grades.length) {
    throw new ApiError(500, 'Invalid assignment repo review completion result')
  }

  return parsed.data.docs
}

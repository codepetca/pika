import { ApiError, apiErrors } from '@/lib/api-handler'
import { loadTeacherOwnedAssignment } from '@/lib/server/assignments'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  assignmentFeedbackReturnResultSchema,
  assignmentReturnResultSchema,
  type AssignmentReturnResult,
} from '@/lib/validations/assignment-returns'

function parseRpcResult<T>(opts: {
  value: unknown
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }
  errorMessage: string
}): T {
  const parsed = opts.schema.safeParse(opts.value)
  if (!parsed.success) {
    throw new ApiError(500, opts.errorMessage)
  }
  return parsed.data
}

export async function returnAssignmentFeedback(opts: {
  assignmentId: string
  studentId: string
  teacherId: string
  feedback?: string
  expectedDocUpdatedAt: string | null
}) {
  const { assignmentId, studentId, teacherId, feedback, expectedDocUpdatedAt } = opts
  const supabase = getServiceRoleClient()
  const now = new Date().toISOString()
  const { data, error } = await supabase.rpc('return_assignment_feedback_atomic', {
    p_assignment_id: assignmentId,
    p_student_id: studentId,
    p_teacher_id: teacherId,
    p_feedback: feedback ?? null,
    p_expected_doc_updated_at: expectedDocUpdatedAt,
    p_now: now,
  })

  if (error) {
    if (error.code === '42501') {
      throw new ApiError(403, error.message)
    }
    if (error.code === '40001') {
      throw new ApiError(409, 'Assignment document changed; retry return')
    }
    if (error.code === '22023' && error.message === 'Student is not enrolled in this classroom') {
      throw apiErrors.badRequest(error.message)
    }
    if (error.code === '22023' && error.message === 'Comment draft is required before returning comments') {
      throw apiErrors.badRequest(error.message)
    }
    throw new ApiError(500, 'Failed to return assignment feedback')
  }

  const result = parseRpcResult({
    value: data,
    schema: assignmentFeedbackReturnResultSchema,
    errorMessage: 'Invalid assignment feedback return result',
  })
  if (!result.applied) {
    throw new ApiError(409, 'Assignment feedback changed; reload and try again')
  }

  return {
    doc: result.doc,
    entry: result.entry,
  }
}

export async function returnAssignmentsToStudents(opts: {
  assignmentId: string
  teacherId: string
  studentIds: string[]
}): Promise<AssignmentReturnResult> {
  const { assignmentId, teacherId, studentIds } = opts
  const supabase = getServiceRoleClient()
  await loadTeacherOwnedAssignment({
    supabase,
    assignmentId,
    teacherId,
  })

  const { data, error } = await supabase.rpc('return_assignment_docs_with_feedback_atomic', {
    p_assignment_id: assignmentId,
    p_student_ids: studentIds,
    p_teacher_id: teacherId,
    p_now: new Date().toISOString(),
  })

  if (error) {
    if (error.code === '42501') {
      throw new ApiError(403, error.message)
    }
    if (error.code === '40001') {
      throw new ApiError(409, 'Assignment document changed; retry return')
    }
    throw new ApiError(500, 'Failed to return docs')
  }

  return parseRpcResult({
    value: data,
    schema: assignmentReturnResultSchema,
    errorMessage: 'Invalid assignment return result',
  })
}

import { ApiError, apiErrors } from '@/lib/api-handler'
import { isRetryableDatabaseContention } from '@/lib/server/database-contention'
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
  statusCode?: number
}): T {
  const parsed = opts.schema.safeParse(opts.value)
  if (!parsed.success) {
    throw new ApiError(opts.statusCode ?? 500, opts.errorMessage)
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

function mapContextualReturnError(error: { code?: string; message?: string }): never {
  if (error.code === 'P0002') throw new ApiError(404, 'Assignment not found')
  if (error.code === '42501') throw new ApiError(403, 'Unauthorized')
  if (error.code === '55000' && error.message === 'assignment_feedback_return_archived') {
    throw new ApiError(403, 'Assignment is archived')
  }
  if (error.code === '40001' || isRetryableDatabaseContention(error)) {
    throw new ApiError(409, 'Assignment document changed; retry return')
  }
  if (error.code === '22023') throw apiErrors.badRequest(error.message ?? 'Invalid assignment return request')
  throw new ApiError(503, 'Unable to return assignment feedback')
}

export async function returnAssignmentFeedbackForOwner(opts: {
  assignmentId: string
  studentId: string
  actorId: string
  feedback?: string
  expectedDocUpdatedAt: string | null
}) {
  const studentId = opts.studentId.toLowerCase()
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase.rpc('return_assignment_feedback_for_owner_v1', {
    p_actor_id: opts.actorId,
    p_assignment_id: opts.assignmentId,
    p_student_id: studentId,
    p_feedback: opts.feedback ?? null,
    p_expected_doc_updated_at: opts.expectedDocUpdatedAt,
    p_now: new Date().toISOString(),
  })
  if (error) mapContextualReturnError(error)

  const result = parseRpcResult({
    value: data,
    schema: assignmentFeedbackReturnResultSchema,
    errorMessage: 'Invalid assignment feedback return result',
    statusCode: 503,
  })
  if (!result.applied) {
    throw new ApiError(409, 'Assignment feedback changed; reload and try again')
  }
  if (result.doc.assignment_id !== opts.assignmentId
    || result.doc.student_id !== studentId
    || result.entry.assignment_id !== opts.assignmentId
    || result.entry.student_id !== studentId
    || result.entry.entry_kind !== 'teacher_feedback'
    || result.entry.author_type !== 'teacher'
    || result.entry.created_by !== opts.actorId
    || result.entry.body !== result.doc.feedback
    || result.entry.returned_at !== result.doc.feedback_returned_at
  ) {
    throw new ApiError(503, 'Invalid assignment feedback return result')
  }
  return { doc: result.doc, entry: result.entry }
}

export async function returnAssignmentsForOwner(opts: {
  assignmentId: string
  actorId: string
  studentIds: string[]
}): Promise<AssignmentReturnResult> {
  const studentIds = Array.from(new Set(opts.studentIds.map((studentId) => studentId.toLowerCase())))
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase.rpc('return_assignment_docs_for_owner_v1', {
    p_actor_id: opts.actorId,
    p_assignment_id: opts.assignmentId,
    p_student_ids: studentIds,
    p_now: new Date().toISOString(),
  })
  if (error) mapContextualReturnError(error)

  const result = parseRpcResult({
    value: data,
    schema: assignmentReturnResultSchema,
    errorMessage: 'Invalid assignment return result',
    statusCode: 503,
  })
  const requested = new Set(studentIds)
  const sameSet = (left: string[], right: string[]) => (
    left.length === right.length && left.every((id) => right.includes(id))
  )
  const categories = [
    result.returned_student_ids,
    result.blocked_student_ids,
    result.already_returned_student_ids,
    result.missing_student_ids,
  ]
  const flattened = categories.flat()
  const valid = result.returned_count === result.returned_student_ids.length
    && result.cleared_count === result.returned_count
    && result.updated_count + result.created_count === result.returned_count
    && result.created_count === result.created_student_ids.length
    && new Set(result.created_student_ids).size === result.created_student_ids.length
    && result.created_student_ids.every((id) => result.returned_student_ids.includes(id))
    && result.blocked_count === result.blocked_student_ids.length
    && result.already_returned_count === result.already_returned_student_ids.length
    && result.missing_count === result.missing_student_ids.length
    && result.not_enrolled_count === result.not_enrolled_student_ids.length
    && sameSet(result.missing_student_ids, result.not_enrolled_student_ids)
    && result.mailbox_tracking_available === true
    && flattened.length === requested.size
    && new Set(flattened).size === requested.size
    && flattened.every((id) => requested.has(id))
  if (!valid) throw new ApiError(503, 'Invalid assignment return result')
  return result
}

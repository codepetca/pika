type AssignmentVisibilityRecord = {
  is_draft: boolean
  released_at: string | null
}

export function isAssignmentVisibleToStudents(
  assignment: AssignmentVisibilityRecord,
  now: Date = new Date()
): boolean {
  if (assignment.is_draft) return false
  if (!assignment.released_at) return true
  return new Date(assignment.released_at).getTime() <= now.getTime()
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

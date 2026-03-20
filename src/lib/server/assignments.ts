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

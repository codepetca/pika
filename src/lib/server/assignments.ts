export { isAssignmentVisibleToStudents } from '@/lib/assignments'

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

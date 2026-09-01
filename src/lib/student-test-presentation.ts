import type { StudentTestView } from '@/types'

export type StudentTestSummary = Pick<StudentTestView, 'title' | 'status' | 'student_status' | 'effective_access'>

/** Presentation only: access and progress remain owned by the student API. */
export function getStudentTestPresentation(test: StudentTestSummary) {
  const accessClosed = (test.effective_access ?? (test.status === 'closed' ? 'closed' : 'open')) === 'closed'
  const unavailable = test.student_status === 'not_started' && accessClosed

  if (test.student_status === 'can_view_results') {
    return { unavailable, label: 'Returned', description: 'View your feedback', badgeClass: 'bg-info-bg text-info' }
  }
  if (test.student_status === 'responded') {
    return {
      unavailable,
      label: 'Submitted',
      description: accessClosed ? 'Awaiting results · Access closed' : 'Awaiting results',
      badgeClass: 'bg-surface-2 text-text-muted',
    }
  }
  return unavailable
    ? { unavailable, label: 'Closed', description: 'This test is closed', badgeClass: 'bg-surface-3 text-text-muted' }
    : { unavailable, label: 'Available', description: 'Ready to start', badgeClass: 'bg-success-bg text-success' }
}

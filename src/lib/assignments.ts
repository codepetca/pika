import { Assignment, AssignmentDoc, AssignmentStatus } from '@/types'
import { formatInTimeZone } from 'date-fns-tz'

/**
 * Calculate the status of an assignment for a student
 *
 * Status logic:
 * - no assignment_docs row: "not_started"
 * - is_submitted = false && now <= due_at: "in_progress"
 * - is_submitted = false && now > due_at: "in_progress_late"
 * - is_submitted = true && submitted_at <= due_at: "submitted_on_time"
 * - is_submitted = true && submitted_at > due_at: "submitted_late"
 */
export function calculateAssignmentStatus(
  assignment: Assignment,
  doc: AssignmentDoc | null | undefined
): AssignmentStatus {
  const now = new Date()
  const dueAt = new Date(assignment.due_at)

  // No doc exists - not started
  if (!doc) {
    return 'not_started'
  }

  // Doc exists but not submitted
  if (!doc.is_submitted) {
    return now <= dueAt ? 'in_progress' : 'in_progress_late'
  }

  // Doc is submitted - check if on time or late
  if (doc.submitted_at) {
    const submittedAt = new Date(doc.submitted_at)
    return submittedAt <= dueAt ? 'submitted_on_time' : 'submitted_late'
  }

  // Fallback (shouldn't happen - submitted but no submitted_at)
  return 'submitted_on_time'
}

/**
 * Get human-readable label for assignment status
 */
export function getAssignmentStatusLabel(status: AssignmentStatus): string {
  switch (status) {
    case 'not_started':
      return 'Not started'
    case 'in_progress':
      return 'In progress'
    case 'in_progress_late':
      return 'In progress (late)'
    case 'submitted_on_time':
      return 'Submitted'
    case 'submitted_late':
      return 'Submitted (late)'
    default:
      return 'Unknown'
  }
}

/**
 * Get badge styling classes for assignment status
 */
export function getAssignmentStatusBadgeClass(status: AssignmentStatus): string {
  switch (status) {
    case 'not_started':
      return 'bg-gray-100 text-gray-700'
    case 'in_progress':
      return 'bg-blue-100 text-blue-700'
    case 'in_progress_late':
      return 'bg-yellow-100 text-yellow-700'
    case 'submitted_on_time':
      return 'bg-green-100 text-green-700'
    case 'submitted_late':
      return 'bg-orange-100 text-orange-700'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

/**
 * Format a due date for display
 * Example: "Tue Dec 16, 2025"
 */
export function formatDueDate(dueAt: string): string {
  return formatInTimeZone(new Date(dueAt), 'America/Toronto', 'EEE MMM d, yyyy')
}

/**
 * Check if an assignment is past due
 */
export function isPastDue(dueAt: string): boolean {
  return new Date() > new Date(dueAt)
}

/**
 * Format relative time (e.g., "Due in 2 days", "Due 3 hours ago")
 */
export function formatRelativeDueDate(dueAt: string): string {
  const now = new Date()
  const due = new Date(dueAt)
  const diffMs = due.getTime() - now.getTime()
  const diffMins = Math.round(diffMs / 60000)
  const diffHours = Math.round(diffMs / 3600000)
  const diffDays = Math.round(diffMs / 86400000)

  if (diffMs > 0) {
    // Future
    if (diffDays > 1) return `Due in ${diffDays} days`
    if (diffDays === 1) return 'Due tomorrow'
    if (diffHours > 1) return `Due in ${diffHours} hours`
    if (diffHours === 1) return 'Due in 1 hour'
    if (diffMins > 1) return `Due in ${diffMins} minutes`
    return 'Due now'
  } else {
    // Past
    const absDays = Math.abs(diffDays)
    const absHours = Math.abs(diffHours)
    const absMins = Math.abs(diffMins)

    if (absDays > 1) return `${absDays} days overdue`
    if (absDays === 1) return '1 day overdue'
    if (absHours > 1) return `${absHours} hours overdue`
    if (absHours === 1) return '1 hour overdue'
    if (absMins > 1) return `${absMins} minutes overdue`
    return 'Just passed'
  }
}

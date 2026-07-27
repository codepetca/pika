/**
 * Assessment utilities for status calculation, validation, and result aggregation.
 *
 * Tests are the only active assessment domain.
 */

import type {
  TestAssessment,
  TestAssessmentQuestion,
  TestAssessmentResponse,
  TestAssessmentStatus,
  TestAssessmentType,
  TestAssessmentWithStats,
  TestFocusEventType,
  TestFocusSummary,
  TestResultsAggregate,
  StudentTestStatus,
} from '@/types'

/**
 * Get human-readable label for assessment status.
 */
export function getAssessmentStatusBaseLabel(status: TestAssessmentStatus): string {
  const labels: Record<TestAssessmentStatus, string> = {
    draft: 'Draft',
    active: 'Active',
    closed: 'Closed',
  }
  return labels[status]
}

export function getAssessmentStatusLabel(
  status: TestAssessmentStatus,
  assessmentType: TestAssessmentType
): string {
  if (assessmentType === 'test' && status === 'active') return 'Open'
  return getAssessmentStatusBaseLabel(status)
}

export function getTeacherTestListDisplayStatus(
  test: Pick<TestAssessment, 'status'> & {
    stats?: Partial<TestAssessmentWithStats['stats']> | null
  }
): TestAssessmentStatus {
  if (test.status !== 'active') return test.status

  const totalStudents = toNonNegativeCount(test.stats?.total_students)
  const openAccess = toNonNegativeCount(test.stats?.open_access)
  const closedAccess = toNonNegativeCount(test.stats?.closed_access)

  if (
    openAccess === 0 &&
    closedAccess !== null &&
    totalStudents !== null &&
    totalStudents > 0 &&
    closedAccess >= totalStudents
  ) {
    return 'closed'
  }

  return 'active'
}

function toNonNegativeCount(value: unknown): number | null {
  const count = Number(value)
  if (!Number.isFinite(count)) return null
  return Math.max(0, Math.trunc(count))
}

/**
 * Get badge CSS classes for assessment status.
 */
export function getAssessmentStatusBadgeClass(status: TestAssessmentStatus): string {
  const classes: Record<TestAssessmentStatus, string> = {
    draft: 'bg-surface-2 text-text-muted',
    active: 'bg-success-bg text-success',
    closed: 'bg-danger-bg text-danger',
  }
  return classes[status]
}

/**
 * Check if a student can respond to an assessment.
 */
export function canStudentRespond(
  assessment: Pick<TestAssessment, 'status'>,
  hasResponded: boolean
): boolean {
  return assessment.status === 'active' && !hasResponded
}

/**
 * Check if a student can view assessment results released through show_results.
 */
export function canStudentViewResults(
  assessment: Pick<TestAssessment, 'show_results' | 'status'>,
  hasResponded: boolean
): boolean {
  return assessment.show_results && assessment.status === 'closed' && hasResponded
}

/**
 * Check if a student can view test results.
 * Tests are released when work has been explicitly returned by the teacher.
 */
export function canStudentViewTestResults(
  test: Pick<TestAssessment, 'status'>,
  hasResponded: boolean,
  returnedAt: string | null | undefined | boolean
): boolean {
  return test.status === 'closed' && hasResponded && Boolean(returnedAt)
}

/**
 * Get the student's status for a test.
 */
export function getStudentAssessmentStatus(
  assessment: Pick<TestAssessment, 'status'>,
  hasResponded: boolean,
  opts?: { returnedAt?: string | null | boolean }
): StudentTestStatus {
  if (!hasResponded) return 'not_started'
  if (assessment.status === 'closed') {
    if (opts?.returnedAt) return 'can_view_results'
  }
  return 'responded'
}

/**
 * Get the student's status for a test.
 * Tests become viewable once the teacher returns the submitted work.
 */
export function getStudentTestStatus(
  test: Pick<TestAssessment, 'status'>,
  hasResponded: boolean,
  returnedAt: string | null | undefined | boolean
): StudentTestStatus {
  return getStudentAssessmentStatus(test, hasResponded, { returnedAt })
}

/**
 * Check if assessment questions can be edited.
 * Policy: teachers can edit question sets at any stage.
 */
export function canEditAssessmentQuestions(
  _assessment: Pick<TestAssessment, 'status'>,
  _hasResponses: boolean
): boolean {
  return true
}

/**
 * Aggregate assessment responses into per-question results.
 */
export function aggregateResults(
  questions: TestAssessmentQuestion[],
  responses: TestAssessmentResponse[]
): TestResultsAggregate[] {
  return questions.map((q) => {
    const questionResponses = responses.filter((r) => r.question_id === q.id)
    const counts = q.options.map((_, idx) =>
      questionResponses.filter((r) => r.selected_option === idx).length
    )
    return {
      question_id: q.id,
      question_text: q.question_text,
      options: q.options,
      counts,
      total_responses: questionResponses.length,
    }
  })
}

/** Maximum number of options per test question. */
export const MAX_ASSESSMENT_OPTIONS = 6

/**
 * Validate assessment question options.
 */
export function validateAssessmentOptions(options: string[]): { valid: boolean; error?: string } {
  if (options.length < 2) return { valid: false, error: 'At least 2 options required' }
  if (options.length > MAX_ASSESSMENT_OPTIONS) return { valid: false, error: `Maximum ${MAX_ASSESSMENT_OPTIONS} options allowed` }
  if (options.some((o) => !o.trim())) return { valid: false, error: 'Options cannot be empty' }
  return { valid: true }
}

/**
 * Check if an assessment can be activated (draft -> active).
 */
export function canActivateAssessment(
  assessment: Pick<TestAssessment, 'status'>,
  questionsCount: number
): { valid: boolean; error?: string } {
  if (assessment.status !== 'draft') {
    return { valid: false, error: 'Only draft tests can be activated' }
  }
  if (questionsCount < 1) {
    return { valid: false, error: 'Test must have at least 1 question' }
  }
  return { valid: true }
}

type FocusEventLike = {
  event_type: TestFocusEventType
  occurred_at: string
}

export const ASSESSMENT_EXIT_BURST_WINDOW_MS = 2000

type AssessmentExitSummaryLike = ({
  exit_count?: number | null
} & Pick<
  TestFocusSummary,
  'away_count' | 'route_exit_attempts' | 'window_unmaximize_attempts'
>) | null | undefined

export function getAssessmentExitCount(summary: AssessmentExitSummaryLike): number {
  if (!summary) return 0

  const exitCount = Number(summary.exit_count)
  if (Number.isFinite(exitCount) && exitCount >= 0) {
    return Math.trunc(exitCount)
  }

  const awayCount = Math.max(0, Math.trunc(Number(summary.away_count) || 0))
  const routeExitAttempts = Math.max(0, Math.trunc(Number(summary.route_exit_attempts) || 0))
  const windowUnmaximizeAttempts = Math.max(
    0,
    Math.trunc(Number(summary.window_unmaximize_attempts) || 0)
  )

  return awayCount + routeExitAttempts + windowUnmaximizeAttempts
}

export function emptyAssessmentFocusSummary(): TestFocusSummary {
  return {
    exit_count: 0,
    away_count: 0,
    away_total_seconds: 0,
    route_exit_attempts: 0,
    window_unmaximize_attempts: 0,
    last_away_started_at: null,
    last_away_ended_at: null,
  }
}

export function summarizeAssessmentFocusEvents(events: FocusEventLike[]): TestFocusSummary {
  if (!events.length) return emptyAssessmentFocusSummary()

  const sorted = [...events].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  )

  const summary = emptyAssessmentFocusSummary()
  let activeAwayStartedAtMs: number | null = null
  let lastExitAtMs: number | null = null

  for (const event of sorted) {
    const eventAtMs = new Date(event.occurred_at).getTime()
    if (Number.isNaN(eventAtMs)) continue

    const shouldCountExit =
      lastExitAtMs === null || eventAtMs - lastExitAtMs > ASSESSMENT_EXIT_BURST_WINDOW_MS

    if (event.event_type === 'route_exit_attempt') {
      summary.route_exit_attempts += 1
      if (shouldCountExit) {
        summary.exit_count += 1
      }
      lastExitAtMs = eventAtMs
      continue
    }

    if (event.event_type === 'window_unmaximize_attempt') {
      summary.window_unmaximize_attempts += 1
      if (shouldCountExit) {
        summary.exit_count += 1
      }
      lastExitAtMs = eventAtMs
      continue
    }

    if (event.event_type === 'away_start') {
      if (activeAwayStartedAtMs === null) {
        activeAwayStartedAtMs = eventAtMs
        summary.away_count += 1
        if (shouldCountExit) {
          summary.exit_count += 1
        }
        lastExitAtMs = eventAtMs
      }
      summary.last_away_started_at = event.occurred_at
      continue
    }

    if (event.event_type === 'away_end') {
      if (activeAwayStartedAtMs !== null && eventAtMs >= activeAwayStartedAtMs) {
        summary.away_total_seconds += Math.max(
          0,
          Math.round((eventAtMs - activeAwayStartedAtMs) / 1000)
        )
      }
      activeAwayStartedAtMs = null
      lastExitAtMs = null
      summary.last_away_ended_at = event.occurred_at
    }
  }

  return summary
}

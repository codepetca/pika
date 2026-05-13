/**
 * Quiz utilities for status calculation, validation, and result aggregation
 */

import type {
  Quiz,
  QuizAssessmentType,
  QuizFocusEventType,
  QuizFocusSummary,
  QuizQuestion,
  QuizResponse,
  QuizWithStats,
  QuizStatus,
  StudentQuizStatus,
  QuizResultsAggregate,
} from '@/types'

/**
 * Get human-readable label for quiz status
 */
export function getQuizStatusLabel(status: QuizStatus): string {
  const labels: Record<QuizStatus, string> = {
    draft: 'Draft',
    active: 'Active',
    closed: 'Closed',
  }
  return labels[status]
}

export function getAssessmentStatusLabel(
  status: QuizStatus,
  assessmentType: QuizAssessmentType
): string {
  if (assessmentType === 'test' && status === 'active') return 'Open'
  return getQuizStatusLabel(status)
}

export function getTeacherTestListDisplayStatus(
  test: Pick<Quiz, 'status'> & {
    stats?: Partial<QuizWithStats['stats']> | null
  }
): QuizStatus {
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
 * Get badge CSS classes for quiz status
 */
export function getQuizStatusBadgeClass(status: QuizStatus): string {
  const classes: Record<QuizStatus, string> = {
    draft: 'bg-surface-2 text-text-muted',
    active: 'bg-success-bg text-success',
    closed: 'bg-danger-bg text-danger',
  }
  return classes[status]
}

export function getQuizAssessmentType(quiz: { assessment_type?: QuizAssessmentType | null }): QuizAssessmentType {
  return quiz.assessment_type === 'test' ? 'test' : 'quiz'
}

/**
 * Check if a student can respond to a quiz
 */
export function canStudentRespond(quiz: Pick<Quiz, 'status'>, hasResponded: boolean): boolean {
  return quiz.status === 'active' && !hasResponded
}

/**
 * Check if a student can view quiz results
 */
export function canStudentViewResults(
  quiz: Pick<Quiz, 'show_results' | 'status'>,
  hasResponded: boolean
): boolean {
  return quiz.show_results && quiz.status === 'closed' && hasResponded
}

/**
 * Check if a student can view test results.
 * Tests are released when work has been explicitly returned by the teacher.
 */
export function canStudentViewTestResults(
  test: Pick<Quiz, 'status'>,
  hasResponded: boolean,
  returnedAt: string | null | undefined | boolean
): boolean {
  return test.status === 'closed' && hasResponded && Boolean(returnedAt)
}

/**
 * Get the student's status for any assessment (quiz or test).
 *
 * - Quiz-style: pass `show_results` on the assessment object — results visible when closed + show_results.
 * - Test-style: pass `opts.returnedAt` — results visible when closed + teacher has returned the work.
 *
 * Both wrappers below delegate here; call this directly when you have a mixed-type assessment.
 */
export function getStudentAssessmentStatus(
  assessment: Pick<Quiz, 'status'> & { show_results?: boolean | null },
  hasResponded: boolean,
  opts?: { returnedAt?: string | null | boolean }
): StudentQuizStatus {
  if (!hasResponded) return 'not_started'
  if (assessment.status === 'closed') {
    if (opts?.returnedAt) return 'can_view_results'
    if (assessment.show_results) return 'can_view_results'
  }
  return 'responded'
}

/**
 * Get the student's status for a quiz.
 * Results become visible when the quiz is closed and show_results is enabled.
 */
export function getStudentQuizStatus(
  quiz: Pick<Quiz, 'show_results' | 'status'>,
  hasResponded: boolean
): StudentQuizStatus {
  return getStudentAssessmentStatus(quiz, hasResponded)
}

/**
 * Get the student's status for a test.
 * Tests become viewable once the teacher returns the submitted work.
 */
export function getStudentTestStatus(
  test: Pick<Quiz, 'status'>,
  hasResponded: boolean,
  returnedAt: string | null | undefined | boolean
): StudentQuizStatus {
  return getStudentAssessmentStatus(test, hasResponded, { returnedAt })
}

/**
 * Check if quiz/test questions can be edited.
 * Policy: teachers can edit question sets at any stage.
 */
export function canEditQuizQuestions(
  _quiz: Pick<Quiz, 'status'>,
  _hasResponses: boolean
): boolean {
  return true
}

/**
 * Aggregate quiz responses into per-question results
 */
export function aggregateResults(
  questions: QuizQuestion[],
  responses: QuizResponse[]
): QuizResultsAggregate[] {
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

/** Maximum number of options per quiz question */
export const MAX_QUIZ_OPTIONS = 6

/**
 * Validate quiz question options
 */
export function validateQuizOptions(options: string[]): { valid: boolean; error?: string } {
  if (options.length < 2) return { valid: false, error: 'At least 2 options required' }
  if (options.length > MAX_QUIZ_OPTIONS) return { valid: false, error: `Maximum ${MAX_QUIZ_OPTIONS} options allowed` }
  if (options.some((o) => !o.trim())) return { valid: false, error: 'Options cannot be empty' }
  return { valid: true }
}

/**
 * Check if a quiz can be activated (draft → active)
 */
export function canActivateQuiz(
  quiz: Pick<Quiz, 'status'>,
  questionsCount: number
): { valid: boolean; error?: string } {
  if (quiz.status !== 'draft') {
    return { valid: false, error: 'Only draft quizzes can be activated' }
  }
  if (questionsCount < 1) {
    return { valid: false, error: 'Quiz must have at least 1 question' }
  }
  return { valid: true }
}

type FocusEventLike = {
  event_type: QuizFocusEventType
  occurred_at: string
}

export const QUIZ_EXIT_BURST_WINDOW_MS = 2000

type QuizExitSummaryLike = ({
  exit_count?: number | null
} & Pick<
  QuizFocusSummary,
  'away_count' | 'route_exit_attempts' | 'window_unmaximize_attempts'
>) | null | undefined

export function getQuizExitCount(summary: QuizExitSummaryLike): number {
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

export function emptyQuizFocusSummary(): QuizFocusSummary {
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

export function summarizeQuizFocusEvents(events: FocusEventLike[]): QuizFocusSummary {
  if (!events.length) return emptyQuizFocusSummary()

  const sorted = [...events].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  )

  const summary = emptyQuizFocusSummary()
  let activeAwayStartedAtMs: number | null = null
  let lastExitAtMs: number | null = null

  for (const event of sorted) {
    const eventAtMs = new Date(event.occurred_at).getTime()
    if (Number.isNaN(eventAtMs)) continue

    const shouldCountExit =
      lastExitAtMs === null || eventAtMs - lastExitAtMs > QUIZ_EXIT_BURST_WINDOW_MS

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

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
 * Get the student's status for a quiz
 */
export function getStudentQuizStatus(
  quiz: Pick<Quiz, 'show_results' | 'status'>,
  hasResponded: boolean
): StudentQuizStatus {
  if (!hasResponded) return 'not_started'
  if (quiz.show_results && quiz.status === 'closed') return 'can_view_results'
  return 'responded'
}

/**
 * Check if quiz questions can be edited (before any responses)
 */
export function canEditQuizQuestions(quiz: Pick<Quiz, 'status'>, hasResponses: boolean): boolean {
  return quiz.status === 'draft' && !hasResponses
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

export function emptyQuizFocusSummary(): QuizFocusSummary {
  return {
    away_count: 0,
    away_total_seconds: 0,
    route_exit_attempts: 0,
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

  for (const event of sorted) {
    const eventAtMs = new Date(event.occurred_at).getTime()
    if (Number.isNaN(eventAtMs)) continue

    if (event.event_type === 'route_exit_attempt') {
      summary.route_exit_attempts += 1
      continue
    }

    if (event.event_type === 'away_start') {
      if (activeAwayStartedAtMs === null) {
        activeAwayStartedAtMs = eventAtMs
        summary.away_count += 1
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
      summary.last_away_ended_at = event.occurred_at
    }
  }

  return summary
}

/**
 * Quiz utilities for status calculation, validation, and result aggregation
 */

import type {
  Quiz,
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

/**
 * Check if a student can respond to a quiz
 */
export function canStudentRespond(quiz: Quiz, hasResponded: boolean): boolean {
  return quiz.status === 'active' && !hasResponded
}

/**
 * Check if a student can view quiz results
 */
export function canStudentViewResults(quiz: Quiz, hasResponded: boolean): boolean {
  return quiz.show_results && hasResponded
}

/**
 * Get the student's status for a quiz
 */
export function getStudentQuizStatus(quiz: Quiz, hasResponded: boolean): StudentQuizStatus {
  if (!hasResponded) return 'not_started'
  if (quiz.show_results) return 'can_view_results'
  return 'responded'
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

/**
 * Validate quiz question options
 */
export function validateQuizOptions(options: string[]): { valid: boolean; error?: string } {
  if (options.length < 2) return { valid: false, error: 'At least 2 options required' }
  if (options.some((o) => !o.trim())) return { valid: false, error: 'Options cannot be empty' }
  return { valid: true }
}

/**
 * Check if a quiz can be activated (draft → active)
 */
export function canActivateQuiz(
  quiz: Quiz,
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

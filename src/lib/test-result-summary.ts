export interface TestResultSummary {
  earned_points: number | null
  possible_points: number
  percent: number | null
}

/** An incomplete returned Test is pending grading, never an implicit zero. */
export function summarizeTestQuestionScores(
  questions: readonly { points: number; score: number | null }[],
): TestResultSummary {
  const possiblePoints = questions.reduce((total, question) => total + question.points, 0)
  const complete = questions.length > 0 && questions.every((question) => (
    typeof question.score === 'number' && Number.isFinite(question.score)
  ))
  if (!complete) return { earned_points: null, possible_points: possiblePoints, percent: null }
  const earnedPoints = questions.reduce((total, question) => total + (question.score ?? 0), 0)
  return {
    earned_points: earnedPoints,
    possible_points: possiblePoints,
    percent: possiblePoints > 0 ? (earnedPoints / possiblePoints) * 100 : 0,
  }
}

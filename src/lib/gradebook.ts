export interface GradebookCategoryInput {
  earned: number
  possible: number
}

export interface GradebookCalculationInput {
  useWeights: boolean
  assignmentsWeight: number
  quizzesWeight: number
  assignments: GradebookCategoryInput[]
  quizzes: GradebookCategoryInput[]
}

export interface GradebookCalculationResult {
  assignmentsPercent: number | null
  quizzesPercent: number | null
  finalPercent: number | null
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function toPercent(rows: GradebookCategoryInput[]): number | null {
  const valid = rows.filter((row) => row.possible > 0 && row.earned >= 0)
  if (valid.length === 0) return null

  const earned = valid.reduce((sum, row) => sum + row.earned, 0)
  const possible = valid.reduce((sum, row) => sum + row.possible, 0)

  if (possible <= 0) return null
  return round2((earned / possible) * 100)
}

export function calculateFinalPercent(input: GradebookCalculationInput): GradebookCalculationResult {
  const assignmentsPercent = toPercent(input.assignments)
  const quizzesPercent = toPercent(input.quizzes)

  if (assignmentsPercent == null && quizzesPercent == null) {
    return { assignmentsPercent: null, quizzesPercent: null, finalPercent: null }
  }

  // Unweighted: blend all scored items by points.
  if (!input.useWeights) {
    const all = [...input.assignments, ...input.quizzes]
    return {
      assignmentsPercent,
      quizzesPercent,
      finalPercent: toPercent(all),
    }
  }

  // Weighted: normalize to categories that have scores.
  const components: Array<{ percent: number; weight: number }> = []
  if (assignmentsPercent != null && input.assignmentsWeight > 0) {
    components.push({ percent: assignmentsPercent, weight: input.assignmentsWeight })
  }
  if (quizzesPercent != null && input.quizzesWeight > 0) {
    components.push({ percent: quizzesPercent, weight: input.quizzesWeight })
  }

  if (components.length === 0) {
    // fall back when scores exist but configured weights are zero
    const fallback = assignmentsPercent ?? quizzesPercent
    return { assignmentsPercent, quizzesPercent, finalPercent: fallback ?? null }
  }

  const weightTotal = components.reduce((sum, c) => sum + c.weight, 0)
  const weighted = components.reduce((sum, c) => sum + c.percent * c.weight, 0) / weightTotal

  return {
    assignmentsPercent,
    quizzesPercent,
    finalPercent: round2(weighted),
  }
}

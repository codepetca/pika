export interface GradebookCategoryInput {
  earned: number
  possible: number
  weight?: number
}

export interface GradebookCalculationInput {
  useWeights: boolean
  assignmentsWeight: number
  testsWeight: number
  assignments: GradebookCategoryInput[]
  tests: GradebookCategoryInput[]
}

export interface GradebookCalculationResult {
  assignmentsPercent: number | null
  testsPercent: number | null
  finalPercent: number | null
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function toPercent(rows: GradebookCategoryInput[]): number | null {
  const valid = rows.filter((row) => row.possible > 0 && row.earned >= 0)
  if (valid.length === 0) return null

  const weightTotal = valid.reduce((sum, row) => {
    const weight = row.weight == null ? row.possible : row.weight
    return sum + (Number.isFinite(weight) && weight > 0 ? weight : 0)
  }, 0)

  if (weightTotal > 0) {
    const weighted = valid.reduce((sum, row) => {
      const weight = row.weight == null ? row.possible : row.weight
      if (!Number.isFinite(weight) || weight <= 0) return sum
      return sum + (row.earned / row.possible) * 100 * weight
    }, 0)

    return round2(weighted / weightTotal)
  }

  const earned = valid.reduce((sum, row) => sum + row.earned, 0)
  const possible = valid.reduce((sum, row) => sum + row.possible, 0)
  if (possible <= 0) return null
  return round2((earned / possible) * 100)
}

export function calculateFinalPercent(input: GradebookCalculationInput): GradebookCalculationResult {
  const assignmentsPercent = toPercent(input.assignments)
  const testsPercent = toPercent(input.tests)

  if (assignmentsPercent == null && testsPercent == null) {
    return {
      assignmentsPercent: null,
      testsPercent: null,
      finalPercent: null,
    }
  }

  // Unweighted: blend all scored items by points.
  if (!input.useWeights) {
    const all = [...input.assignments, ...input.tests]
    return {
      assignmentsPercent,
      testsPercent,
      finalPercent: toPercent(all),
    }
  }

  // Weighted: normalize to categories that have scores.
  const components: Array<{ percent: number; weight: number }> = []
  if (assignmentsPercent != null && input.assignmentsWeight > 0) {
    components.push({ percent: assignmentsPercent, weight: input.assignmentsWeight })
  }
  if (testsPercent != null && input.testsWeight > 0) {
    components.push({ percent: testsPercent, weight: input.testsWeight })
  }

  if (components.length === 0) {
    // fall back when scores exist but configured weights are zero
    const fallback = assignmentsPercent ?? testsPercent
    return { assignmentsPercent, testsPercent, finalPercent: fallback ?? null }
  }

  const weightTotal = components.reduce((sum, c) => sum + c.weight, 0)
  const weighted = components.reduce((sum, c) => sum + c.percent * c.weight, 0) / weightTotal

  return {
    assignmentsPercent,
    testsPercent,
    finalPercent: round2(weighted),
  }
}

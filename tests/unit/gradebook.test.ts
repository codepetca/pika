import { describe, expect, it } from 'vitest'
import {
  calculateAssessmentCourseWeight,
  calculateCategorizedFinalPercent,
  calculateFinalPercent,
} from '@/lib/gradebook'

describe('gradebook final percent', () => {
  it('returns nulls when no scores exist', () => {
    const result = calculateFinalPercent({
      useWeights: false,
      assignmentsWeight: 50,
      testsWeight: 30,
      assignments: [],
      tests: [],
    })

    expect(result).toEqual({
      assignmentsPercent: null,
      testsPercent: null,
      finalPercent: null,
    })
  })

  it('computes unweighted percent using points across categories', () => {
    const result = calculateFinalPercent({
      useWeights: false,
      assignmentsWeight: 50,
      testsWeight: 30,
      assignments: [
        { earned: 24, possible: 30 },
        { earned: 18, possible: 20 },
      ],
      tests: [{ earned: 45, possible: 50 }],
    })

    expect(result.assignmentsPercent).toBe(84)
    expect(result.testsPercent).toBe(90)
    expect(result.finalPercent).toBe(87)
  })

  it('computes weighted percent when enabled', () => {
    const result = calculateFinalPercent({
      useWeights: true,
      assignmentsWeight: 50,
      testsWeight: 30,
      assignments: [{ earned: 24, possible: 30 }],
      tests: [{ earned: 45, possible: 50 }],
    })

    expect(result.assignmentsPercent).toBe(80)
    expect(result.testsPercent).toBe(90)
    expect(result.finalPercent).toBe(83.75)
  })

  it('uses assessment weights separately from points possible', () => {
    const result = calculateFinalPercent({
      useWeights: false,
      assignmentsWeight: 50,
      testsWeight: 30,
      assignments: [
        { earned: 100, possible: 100, weight: 10 },
        { earned: 0, possible: 10, weight: 10 },
      ],
      tests: [],
    })

    expect(result.assignmentsPercent).toBe(50)
    expect(result.finalPercent).toBe(50)
  })

  it('renormalizes weighted calc when one category has no scores', () => {
    const result = calculateFinalPercent({
      useWeights: true,
      assignmentsWeight: 50,
      testsWeight: 30,
      assignments: [{ earned: 27, possible: 30 }],
      tests: [],
    })

    expect(result.assignmentsPercent).toBe(90)
    expect(result.testsPercent).toBeNull()
    expect(result.finalPercent).toBe(90)
  })
})

describe('categorized gradebook final percent', () => {
  it('weights category percentages and ignores uncategorized work', () => {
    const result = calculateCategorizedFinalPercent({
      categories: [
        { id: 'term', percentage: 65 },
        { id: 'final', percentage: 25 },
        { id: 'attendance', percentage: 10 },
      ],
      items: [
        { categoryId: 'term', earned: 80, possible: 100, weight: 10 },
        { categoryId: 'final', earned: 90, possible: 100, weight: 10 },
        { categoryId: null, earned: 0, possible: 100, weight: 999 },
      ],
    })

    expect(result.categoryPercents).toEqual({ term: 80, final: 90, attendance: null })
    expect(result.finalPercent).toBe(82.78)
  })

  it('uses relative assessment weights within a category', () => {
    const result = calculateCategorizedFinalPercent({
      categories: [{ id: 'term', percentage: 100 }],
      items: [
        { categoryId: 'term', earned: 100, possible: 100, weight: 1 },
        { categoryId: 'term', earned: 0, possible: 100, weight: 3 },
      ],
    })

    expect(result.finalPercent).toBe(25)
    expect(calculateAssessmentCourseWeight({
      categoryPercentage: 65,
      assessmentWeight: 1,
      categoryAssessmentWeights: [1, 3],
    })).toBe(16.25)
  })
})

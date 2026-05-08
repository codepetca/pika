import { describe, expect, it } from 'vitest'
import { calculateFinalPercent } from '@/lib/gradebook'

describe('gradebook final percent', () => {
  it('returns nulls when no scores exist', () => {
    const result = calculateFinalPercent({
      useWeights: false,
      assignmentsWeight: 50,
      quizzesWeight: 20,
      testsWeight: 30,
      assignments: [],
      quizzes: [],
      tests: [],
    })

    expect(result).toEqual({
      assignmentsPercent: null,
      quizzesPercent: null,
      testsPercent: null,
      finalPercent: null,
    })
  })

  it('computes unweighted percent using points across categories', () => {
    const result = calculateFinalPercent({
      useWeights: false,
      assignmentsWeight: 50,
      quizzesWeight: 20,
      testsWeight: 30,
      assignments: [
        { earned: 24, possible: 30 },
        { earned: 18, possible: 20 },
      ],
      quizzes: [{ earned: 8, possible: 10 }],
      tests: [{ earned: 45, possible: 50 }],
    })

    expect(result.assignmentsPercent).toBe(84)
    expect(result.quizzesPercent).toBe(80)
    expect(result.testsPercent).toBe(90)
    expect(result.finalPercent).toBe(86.36)
  })

  it('computes weighted percent when enabled', () => {
    const result = calculateFinalPercent({
      useWeights: true,
      assignmentsWeight: 50,
      quizzesWeight: 20,
      testsWeight: 30,
      assignments: [{ earned: 24, possible: 30 }],
      quizzes: [{ earned: 8, possible: 10 }],
      tests: [{ earned: 45, possible: 50 }],
    })

    expect(result.assignmentsPercent).toBe(80)
    expect(result.quizzesPercent).toBe(80)
    expect(result.testsPercent).toBe(90)
    expect(result.finalPercent).toBe(83)
  })

  it('uses assessment weights separately from points possible', () => {
    const result = calculateFinalPercent({
      useWeights: false,
      assignmentsWeight: 50,
      quizzesWeight: 20,
      testsWeight: 30,
      assignments: [
        { earned: 100, possible: 100, weight: 10 },
        { earned: 0, possible: 10, weight: 10 },
      ],
      quizzes: [],
      tests: [],
    })

    expect(result.assignmentsPercent).toBe(50)
    expect(result.finalPercent).toBe(50)
  })

  it('renormalizes weighted calc when one category has no scores', () => {
    const result = calculateFinalPercent({
      useWeights: true,
      assignmentsWeight: 50,
      quizzesWeight: 20,
      testsWeight: 30,
      assignments: [{ earned: 27, possible: 30 }],
      quizzes: [],
      tests: [],
    })

    expect(result.assignmentsPercent).toBe(90)
    expect(result.quizzesPercent).toBeNull()
    expect(result.testsPercent).toBeNull()
    expect(result.finalPercent).toBe(90)
  })
})

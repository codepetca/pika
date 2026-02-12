import { describe, expect, it } from 'vitest'
import { calculateFinalPercent } from '@/lib/gradebook'

describe('gradebook final percent', () => {
  it('returns nulls when no scores exist', () => {
    const result = calculateFinalPercent({
      useWeights: false,
      assignmentsWeight: 70,
      quizzesWeight: 30,
      assignments: [],
      quizzes: [],
    })

    expect(result).toEqual({
      assignmentsPercent: null,
      quizzesPercent: null,
      finalPercent: null,
    })
  })

  it('computes unweighted percent using points across categories', () => {
    const result = calculateFinalPercent({
      useWeights: false,
      assignmentsWeight: 70,
      quizzesWeight: 30,
      assignments: [
        { earned: 24, possible: 30 },
        { earned: 18, possible: 20 },
      ],
      quizzes: [{ earned: 8, possible: 10 }],
    })

    expect(result.assignmentsPercent).toBe(84)
    expect(result.quizzesPercent).toBe(80)
    expect(result.finalPercent).toBe(83.33)
  })

  it('computes weighted percent when enabled', () => {
    const result = calculateFinalPercent({
      useWeights: true,
      assignmentsWeight: 70,
      quizzesWeight: 30,
      assignments: [{ earned: 24, possible: 30 }],
      quizzes: [{ earned: 8, possible: 10 }],
    })

    expect(result.assignmentsPercent).toBe(80)
    expect(result.quizzesPercent).toBe(80)
    expect(result.finalPercent).toBe(80)
  })

  it('renormalizes weighted calc when one category has no scores', () => {
    const result = calculateFinalPercent({
      useWeights: true,
      assignmentsWeight: 70,
      quizzesWeight: 30,
      assignments: [{ earned: 27, possible: 30 }],
      quizzes: [],
    })

    expect(result.assignmentsPercent).toBe(90)
    expect(result.quizzesPercent).toBeNull()
    expect(result.finalPercent).toBe(90)
  })
})

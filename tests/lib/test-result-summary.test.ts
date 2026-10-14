import { describe, expect, it } from 'vitest'
import { summarizeTestQuestionScores } from '@/lib/test-result-summary'

describe('returned Test score summary', () => {
  it('keeps ungraded and partially graded work pending rather than counting missing scores as zero', () => {
    for (const score of [null, 3]) {
      expect(summarizeTestQuestionScores([{ points: 5, score }, { points: 5, score: null }])).toEqual({
        earned_points: null, possible_points: 10, percent: null,
      })
    }
  })
  it('includes deliberate zero scores in a complete result', () => {
    expect(summarizeTestQuestionScores([{ points: 5, score: 0 }])).toEqual({ earned_points: 0, possible_points: 5, percent: 0 })
    expect(summarizeTestQuestionScores([{ points: 5, score: 0 }, { points: 5, score: 4 }])).toEqual({
      earned_points: 4, possible_points: 10, percent: 40,
    })
  })
  it('does not assign a final score to absent questions or nonfinite grades', () => {
    expect(summarizeTestQuestionScores([])).toEqual({ earned_points: null, possible_points: 0, percent: null })
    for (const score of [NaN, Infinity, -Infinity]) {
      expect(summarizeTestQuestionScores([{ points: 5, score }]).earned_points).toBeNull()
    }
  })
})

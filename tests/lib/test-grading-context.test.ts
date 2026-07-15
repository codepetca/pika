import { describe, expect, it } from 'vitest'
import { hasPersistedTestResponseGrade } from '@/lib/test-grading-context'

describe('test grading context', () => {
  it('preserves blank responses that a teacher already graded', () => {
    expect(hasPersistedTestResponseGrade({
      graded_at: '2026-07-14T16:00:00.000Z',
      score: 0,
      feedback: 'Unanswered by policy',
    })).toBe(true)
  })

  it('allows a truly ungraded blank response to receive the unanswered grade', () => {
    expect(hasPersistedTestResponseGrade({
      graded_at: null,
      score: null,
      feedback: null,
    })).toBe(false)
  })
})

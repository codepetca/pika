import { describe, expect, it } from 'vitest'
import { hasAssessmentOpened, isAssessmentVisibleToStudents } from '@/lib/server/assessments'

describe('assessment scheduling visibility helpers', () => {
  it('treats active quizzes with null opens_at as open/visible', () => {
    const quiz = { status: 'active' as const, opens_at: null }
    expect(isAssessmentVisibleToStudents(quiz)).toBe(true)
    expect(hasAssessmentOpened(quiz)).toBe(true)
  })

  it('hides active quizzes scheduled in the future', () => {
    const now = new Date('2026-03-01T12:00:00.000Z')
    const quiz = { status: 'active' as const, opens_at: '2026-03-01T13:00:00.000Z' }
    expect(isAssessmentVisibleToStudents(quiz, now)).toBe(false)
    expect(hasAssessmentOpened(quiz, now)).toBe(false)
  })

  it('shows active quizzes scheduled in the past', () => {
    const now = new Date('2026-03-01T12:00:00.000Z')
    const quiz = { status: 'active' as const, opens_at: '2026-03-01T11:59:59.000Z' }
    expect(isAssessmentVisibleToStudents(quiz, now)).toBe(true)
    expect(hasAssessmentOpened(quiz, now)).toBe(true)
  })

  it('never marks non-active quizzes as visible/open', () => {
    const now = new Date('2026-03-01T12:00:00.000Z')
    expect(isAssessmentVisibleToStudents({ status: 'draft', opens_at: null }, now)).toBe(false)
    expect(isAssessmentVisibleToStudents({ status: 'closed', opens_at: null }, now)).toBe(false)
    expect(hasAssessmentOpened({ status: 'draft', opens_at: null }, now)).toBe(false)
    expect(hasAssessmentOpened({ status: 'closed', opens_at: null }, now)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { hasQuizOpened, isQuizVisibleToStudents } from '@/lib/server/quizzes'

describe('quiz scheduling visibility helpers', () => {
  it('treats active quizzes with null opens_at as open/visible', () => {
    const quiz = { status: 'active' as const, opens_at: null }
    expect(isQuizVisibleToStudents(quiz)).toBe(true)
    expect(hasQuizOpened(quiz)).toBe(true)
  })

  it('hides active quizzes scheduled in the future', () => {
    const now = new Date('2026-03-01T12:00:00.000Z')
    const quiz = { status: 'active' as const, opens_at: '2026-03-01T13:00:00.000Z' }
    expect(isQuizVisibleToStudents(quiz, now)).toBe(false)
    expect(hasQuizOpened(quiz, now)).toBe(false)
  })

  it('shows active quizzes scheduled in the past', () => {
    const now = new Date('2026-03-01T12:00:00.000Z')
    const quiz = { status: 'active' as const, opens_at: '2026-03-01T11:59:59.000Z' }
    expect(isQuizVisibleToStudents(quiz, now)).toBe(true)
    expect(hasQuizOpened(quiz, now)).toBe(true)
  })

  it('never marks non-active quizzes as visible/open', () => {
    const now = new Date('2026-03-01T12:00:00.000Z')
    expect(isQuizVisibleToStudents({ status: 'draft', opens_at: null }, now)).toBe(false)
    expect(isQuizVisibleToStudents({ status: 'closed', opens_at: null }, now)).toBe(false)
    expect(hasQuizOpened({ status: 'draft', opens_at: null }, now)).toBe(false)
    expect(hasQuizOpened({ status: 'closed', opens_at: null }, now)).toBe(false)
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getFlaggedQuestions,
  isQuestionFlagged,
  toggleFlaggedQuestion,
  clearFlaggedQuestions,
  getNextFlaggedQuestion,
} from '@/lib/flag-questions'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
})

describe('flag-questions utilities', () => {
  const testId = 'test-123'
  const questionId1 = 'q-1'
  const questionId2 = 'q-2'
  const questionId3 = 'q-3'

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  describe('getFlaggedQuestions', () => {
    it('returns empty array when no questions are flagged', () => {
      expect(getFlaggedQuestions(testId)).toEqual([])
    })

    it('returns array of flagged question IDs', () => {
      toggleFlaggedQuestion(testId, questionId1)
      toggleFlaggedQuestion(testId, questionId2)
      expect(getFlaggedQuestions(testId)).toEqual([questionId1, questionId2])
    })

    it('returns empty array for different test ID', () => {
      toggleFlaggedQuestion(testId, questionId1)
      expect(getFlaggedQuestions('other-test')).toEqual([])
    })
  })

  describe('isQuestionFlagged', () => {
    it('returns false for unflagged question', () => {
      expect(isQuestionFlagged(testId, questionId1)).toBe(false)
    })

    it('returns true for flagged question', () => {
      toggleFlaggedQuestion(testId, questionId1)
      expect(isQuestionFlagged(testId, questionId1)).toBe(true)
    })
  })

  describe('toggleFlaggedQuestion', () => {
    it('flags a question', () => {
      const result = toggleFlaggedQuestion(testId, questionId1)
      expect(result).toBe(true)
      expect(isQuestionFlagged(testId, questionId1)).toBe(true)
    })

    it('unflag a question', () => {
      toggleFlaggedQuestion(testId, questionId1)
      const result = toggleFlaggedQuestion(testId, questionId1)
      expect(result).toBe(false)
      expect(isQuestionFlagged(testId, questionId1)).toBe(false)
    })

    it('maintains order of multiple flagged questions', () => {
      toggleFlaggedQuestion(testId, questionId1)
      toggleFlaggedQuestion(testId, questionId2)
      toggleFlaggedQuestion(testId, questionId3)
      expect(getFlaggedQuestions(testId)).toEqual([questionId1, questionId2, questionId3])
    })

    it('preserves other questions when unflagging one', () => {
      toggleFlaggedQuestion(testId, questionId1)
      toggleFlaggedQuestion(testId, questionId2)
      toggleFlaggedQuestion(testId, questionId3)
      toggleFlaggedQuestion(testId, questionId2)
      expect(getFlaggedQuestions(testId)).toEqual([questionId1, questionId3])
    })
  })

  describe('clearFlaggedQuestions', () => {
    it('removes all flagged questions for a test', () => {
      toggleFlaggedQuestion(testId, questionId1)
      toggleFlaggedQuestion(testId, questionId2)
      clearFlaggedQuestions(testId)
      expect(getFlaggedQuestions(testId)).toEqual([])
    })

    it('does not affect other test IDs', () => {
      toggleFlaggedQuestion(testId, questionId1)
      toggleFlaggedQuestion('other-test', questionId1)
      clearFlaggedQuestions(testId)
      expect(getFlaggedQuestions('other-test')).toEqual([questionId1])
    })
  })

  describe('getNextFlaggedQuestion', () => {
    beforeEach(() => {
      toggleFlaggedQuestion(testId, questionId1)
      toggleFlaggedQuestion(testId, questionId2)
      toggleFlaggedQuestion(testId, questionId3)
    })

    it('returns first flagged question if no current question', () => {
      expect(getNextFlaggedQuestion(testId, null)).toBe(questionId1)
    })

    it('returns next flagged question', () => {
      expect(getNextFlaggedQuestion(testId, questionId1)).toBe(questionId2)
    })

    it('wraps around to first question', () => {
      expect(getNextFlaggedQuestion(testId, questionId3)).toBe(questionId1)
    })

    it('returns first flagged if current is not flagged', () => {
      expect(getNextFlaggedQuestion(testId, 'q-not-flagged')).toBe(questionId1)
    })

    it('returns undefined if no flagged questions', () => {
      clearFlaggedQuestions(testId)
      expect(getNextFlaggedQuestion(testId, null)).toBeUndefined()
    })
  })
})

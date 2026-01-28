/**
 * Unit tests for quiz utilities (src/lib/quizzes.ts)
 * Tests quiz status calculation, validation, and aggregation functions
 */

import { describe, it, expect } from 'vitest'
import {
  getQuizStatusLabel,
  getQuizStatusBadgeClass,
  canStudentRespond,
  canStudentViewResults,
  getStudentQuizStatus,
  canEditQuizQuestions,
  aggregateResults,
  validateQuizOptions,
  canActivateQuiz,
} from '@/lib/quizzes'
import { createMockQuiz, createMockQuizQuestion, createMockQuizResponse } from '../helpers/mocks'

describe('quiz utilities', () => {
  // ==========================================================================
  // getQuizStatusLabel()
  // ==========================================================================

  describe('getQuizStatusLabel', () => {
    it('should return "Draft" for draft status', () => {
      expect(getQuizStatusLabel('draft')).toBe('Draft')
    })

    it('should return "Active" for active status', () => {
      expect(getQuizStatusLabel('active')).toBe('Active')
    })

    it('should return "Closed" for closed status', () => {
      expect(getQuizStatusLabel('closed')).toBe('Closed')
    })
  })

  // ==========================================================================
  // getQuizStatusBadgeClass()
  // ==========================================================================

  describe('getQuizStatusBadgeClass', () => {
    it('should return muted classes for draft status', () => {
      const classes = getQuizStatusBadgeClass('draft')
      expect(classes).toContain('bg-surface-2')
      expect(classes).toContain('text-text-muted')
    })

    it('should return success classes for active status', () => {
      const classes = getQuizStatusBadgeClass('active')
      expect(classes).toContain('bg-success-bg')
      expect(classes).toContain('text-success')
    })

    it('should return danger classes for closed status', () => {
      const classes = getQuizStatusBadgeClass('closed')
      expect(classes).toContain('bg-danger-bg')
      expect(classes).toContain('text-danger')
    })
  })

  // ==========================================================================
  // canStudentRespond()
  // ==========================================================================

  describe('canStudentRespond', () => {
    it('should return true when quiz is active and student has not responded', () => {
      const quiz = createMockQuiz({ status: 'active' })
      expect(canStudentRespond(quiz, false)).toBe(true)
    })

    it('should return false when quiz is active but student has already responded', () => {
      const quiz = createMockQuiz({ status: 'active' })
      expect(canStudentRespond(quiz, true)).toBe(false)
    })

    it('should return false when quiz is draft', () => {
      const quiz = createMockQuiz({ status: 'draft' })
      expect(canStudentRespond(quiz, false)).toBe(false)
    })

    it('should return false when quiz is closed', () => {
      const quiz = createMockQuiz({ status: 'closed' })
      expect(canStudentRespond(quiz, false)).toBe(false)
    })
  })

  // ==========================================================================
  // canStudentViewResults()
  // ==========================================================================

  describe('canStudentViewResults', () => {
    it('should return true when show_results is true, quiz is closed, and student has responded', () => {
      const quiz = createMockQuiz({ show_results: true, status: 'closed' })
      expect(canStudentViewResults(quiz, true)).toBe(true)
    })

    it('should return false when quiz is active even with show_results and responded', () => {
      const quiz = createMockQuiz({ show_results: true, status: 'active' })
      expect(canStudentViewResults(quiz, true)).toBe(false)
    })

    it('should return false when show_results is true but student has not responded', () => {
      const quiz = createMockQuiz({ show_results: true, status: 'closed' })
      expect(canStudentViewResults(quiz, false)).toBe(false)
    })

    it('should return false when show_results is false even if student has responded and quiz is closed', () => {
      const quiz = createMockQuiz({ show_results: false, status: 'closed' })
      expect(canStudentViewResults(quiz, true)).toBe(false)
    })

    it('should return false when both show_results is false and student has not responded', () => {
      const quiz = createMockQuiz({ show_results: false })
      expect(canStudentViewResults(quiz, false)).toBe(false)
    })
  })

  // ==========================================================================
  // getStudentQuizStatus()
  // ==========================================================================

  describe('getStudentQuizStatus', () => {
    it('should return "not_started" when student has not responded', () => {
      const quiz = createMockQuiz({ status: 'active', show_results: true })
      expect(getStudentQuizStatus(quiz, false)).toBe('not_started')
    })

    it('should return "can_view_results" when student has responded, results enabled, and quiz closed', () => {
      const quiz = createMockQuiz({ status: 'closed', show_results: true })
      expect(getStudentQuizStatus(quiz, true)).toBe('can_view_results')
    })

    it('should return "responded" when student has responded but quiz is still active', () => {
      const quiz = createMockQuiz({ status: 'active', show_results: true })
      expect(getStudentQuizStatus(quiz, true)).toBe('responded')
    })

    it('should return "responded" when student has responded but results are disabled', () => {
      const quiz = createMockQuiz({ status: 'closed', show_results: false })
      expect(getStudentQuizStatus(quiz, true)).toBe('responded')
    })
  })

  // ==========================================================================
  // canEditQuizQuestions()
  // ==========================================================================

  describe('canEditQuizQuestions', () => {
    it('should return true when quiz has no responses', () => {
      const quiz = createMockQuiz({ status: 'active' })
      expect(canEditQuizQuestions(quiz, false)).toBe(true)
    })

    it('should return false when quiz has responses', () => {
      const quiz = createMockQuiz({ status: 'active' })
      expect(canEditQuizQuestions(quiz, true)).toBe(false)
    })

    it('should return true for draft quiz with no responses', () => {
      const quiz = createMockQuiz({ status: 'draft' })
      expect(canEditQuizQuestions(quiz, false)).toBe(true)
    })
  })

  // ==========================================================================
  // aggregateResults()
  // ==========================================================================

  describe('aggregateResults', () => {
    it('should aggregate responses correctly for a single question', () => {
      const questions = [
        createMockQuizQuestion({
          id: 'q1',
          question_text: 'Favorite color?',
          options: ['Red', 'Blue', 'Green'],
        }),
      ]
      const responses = [
        createMockQuizResponse({ question_id: 'q1', selected_option: 0 }),
        createMockQuizResponse({ question_id: 'q1', selected_option: 1, student_id: 's2' }),
        createMockQuizResponse({ question_id: 'q1', selected_option: 1, student_id: 's3' }),
      ]

      const result = aggregateResults(questions, responses)

      expect(result).toHaveLength(1)
      expect(result[0].question_id).toBe('q1')
      expect(result[0].question_text).toBe('Favorite color?')
      expect(result[0].options).toEqual(['Red', 'Blue', 'Green'])
      expect(result[0].counts).toEqual([1, 2, 0])
      expect(result[0].total_responses).toBe(3)
    })

    it('should aggregate responses for multiple questions', () => {
      const questions = [
        createMockQuizQuestion({ id: 'q1', options: ['A', 'B'] }),
        createMockQuizQuestion({ id: 'q2', options: ['X', 'Y', 'Z'] }),
      ]
      const responses = [
        createMockQuizResponse({ question_id: 'q1', selected_option: 0, student_id: 's1' }),
        createMockQuizResponse({ question_id: 'q1', selected_option: 1, student_id: 's2' }),
        createMockQuizResponse({ question_id: 'q2', selected_option: 2, student_id: 's1' }),
        createMockQuizResponse({ question_id: 'q2', selected_option: 2, student_id: 's2' }),
      ]

      const result = aggregateResults(questions, responses)

      expect(result).toHaveLength(2)
      expect(result[0].counts).toEqual([1, 1])
      expect(result[0].total_responses).toBe(2)
      expect(result[1].counts).toEqual([0, 0, 2])
      expect(result[1].total_responses).toBe(2)
    })

    it('should handle questions with no responses', () => {
      const questions = [
        createMockQuizQuestion({ id: 'q1', options: ['A', 'B', 'C'] }),
      ]
      const responses: any[] = []

      const result = aggregateResults(questions, responses)

      expect(result).toHaveLength(1)
      expect(result[0].counts).toEqual([0, 0, 0])
      expect(result[0].total_responses).toBe(0)
    })

    it('should handle empty questions array', () => {
      const result = aggregateResults([], [])
      expect(result).toEqual([])
    })
  })

  // ==========================================================================
  // validateQuizOptions()
  // ==========================================================================

  describe('validateQuizOptions', () => {
    it('should return valid for 2 or more non-empty options', () => {
      expect(validateQuizOptions(['A', 'B'])).toEqual({ valid: true })
      expect(validateQuizOptions(['A', 'B', 'C'])).toEqual({ valid: true })
      expect(validateQuizOptions(['A', 'B', 'C', 'D'])).toEqual({ valid: true })
    })

    it('should return invalid for less than 2 options', () => {
      const result1 = validateQuizOptions(['A'])
      expect(result1.valid).toBe(false)
      expect(result1.error).toBe('At least 2 options required')

      const result2 = validateQuizOptions([])
      expect(result2.valid).toBe(false)
      expect(result2.error).toBe('At least 2 options required')
    })

    it('should return invalid for empty option strings', () => {
      const result1 = validateQuizOptions(['A', ''])
      expect(result1.valid).toBe(false)
      expect(result1.error).toBe('Options cannot be empty')

      const result2 = validateQuizOptions(['A', '   '])
      expect(result2.valid).toBe(false)
      expect(result2.error).toBe('Options cannot be empty')
    })

    it('should trim whitespace when checking for empty options', () => {
      const result = validateQuizOptions(['  A  ', '  B  '])
      expect(result.valid).toBe(true)
    })
  })

  // ==========================================================================
  // canActivateQuiz()
  // ==========================================================================

  describe('canActivateQuiz', () => {
    it('should return valid when quiz is draft with at least 1 question', () => {
      const quiz = createMockQuiz({ status: 'draft' })
      expect(canActivateQuiz(quiz, 1)).toEqual({ valid: true })
      expect(canActivateQuiz(quiz, 5)).toEqual({ valid: true })
    })

    it('should return invalid when quiz is not draft', () => {
      const activeQuiz = createMockQuiz({ status: 'active' })
      const result1 = canActivateQuiz(activeQuiz, 5)
      expect(result1.valid).toBe(false)
      expect(result1.error).toBe('Only draft quizzes can be activated')

      const closedQuiz = createMockQuiz({ status: 'closed' })
      const result2 = canActivateQuiz(closedQuiz, 5)
      expect(result2.valid).toBe(false)
      expect(result2.error).toBe('Only draft quizzes can be activated')
    })

    it('should return invalid when quiz has no questions', () => {
      const quiz = createMockQuiz({ status: 'draft' })
      const result = canActivateQuiz(quiz, 0)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Quiz must have at least 1 question')
    })
  })
})

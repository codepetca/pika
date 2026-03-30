/**
 * Unit tests for quiz utilities (src/lib/quizzes.ts)
 * Tests quiz status calculation, validation, and aggregation functions
 */

import { describe, it, expect } from 'vitest'
import {
  getQuizStatusLabel,
  getAssessmentStatusLabel,
  getQuizStatusBadgeClass,
  canStudentRespond,
  canStudentViewResults,
  canStudentViewTestResults,
  getStudentQuizStatus,
  getStudentTestStatus,
  canEditQuizQuestions,
  aggregateResults,
  validateQuizOptions,
  canActivateQuiz,
  emptyQuizFocusSummary,
  getQuizExitCount,
  summarizeQuizFocusEvents,
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

  describe('getAssessmentStatusLabel', () => {
    it('should return "Open" for active tests', () => {
      expect(getAssessmentStatusLabel('active', 'test')).toBe('Open')
    })

    it('should keep "Active" for active quizzes', () => {
      expect(getAssessmentStatusLabel('active', 'quiz')).toBe('Active')
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
  // canStudentViewTestResults()
  // ==========================================================================

  describe('canStudentViewTestResults', () => {
    it('should return true when test is closed, responded, and returned', () => {
      const test = createMockQuiz({ status: 'closed' })
      expect(canStudentViewTestResults(test, true, '2026-03-05T10:00:00.000Z')).toBe(true)
    })

    it('should return false when test is not closed', () => {
      const test = createMockQuiz({ status: 'active' })
      expect(canStudentViewTestResults(test, true, '2026-03-05T10:00:00.000Z')).toBe(false)
    })

    it('should return false when student has not responded', () => {
      const test = createMockQuiz({ status: 'closed' })
      expect(canStudentViewTestResults(test, false, '2026-03-05T10:00:00.000Z')).toBe(false)
    })

    it('should return false when test is not returned', () => {
      const test = createMockQuiz({ status: 'closed' })
      expect(canStudentViewTestResults(test, true, null)).toBe(false)
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
  // getStudentTestStatus()
  // ==========================================================================

  describe('getStudentTestStatus', () => {
    it('should return "not_started" when student has not responded', () => {
      const test = createMockQuiz({ status: 'active' })
      expect(getStudentTestStatus(test, false, null)).toBe('not_started')
    })

    it('should return "responded" when test is responded but not returned', () => {
      const test = createMockQuiz({ status: 'closed' })
      expect(getStudentTestStatus(test, true, null)).toBe('responded')
    })

    it('should return "can_view_results" when test is closed and returned', () => {
      const test = createMockQuiz({ status: 'closed' })
      expect(getStudentTestStatus(test, true, '2026-03-05T10:00:00.000Z')).toBe('can_view_results')
    })
  })

  // ==========================================================================
  // canEditQuizQuestions()
  // ==========================================================================

  describe('canEditQuizQuestions', () => {
    it('should return true for draft quizzes', () => {
      const quiz = createMockQuiz({ status: 'draft' })
      expect(canEditQuizQuestions(quiz, false)).toBe(true)
    })

    it('should return true when quiz has responses', () => {
      const quiz = createMockQuiz({ status: 'draft' })
      expect(canEditQuizQuestions(quiz, true)).toBe(true)
    })

    it('should return true for active quizzes', () => {
      const quiz = createMockQuiz({ status: 'active' })
      expect(canEditQuizQuestions(quiz, false)).toBe(true)
    })

    it('should return true for closed quizzes', () => {
      const quiz = createMockQuiz({ status: 'closed' })
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

  // ==========================================================================
  // getQuizExitCount()
  // ==========================================================================

  describe('getQuizExitCount', () => {
    it('returns 0 when summary is missing', () => {
      expect(getQuizExitCount(null)).toBe(0)
      expect(getQuizExitCount(undefined)).toBe(0)
    })

    it('returns exit_count when the summary provides a deduped incident count', () => {
      expect(
        getQuizExitCount({
          exit_count: 3,
          away_count: 4,
          route_exit_attempts: 2,
          window_unmaximize_attempts: 3,
        })
      ).toBe(3)
    })

    it('falls back to combined exits when exit_count is missing', () => {
      expect(
        getQuizExitCount({
          away_count: 4,
          route_exit_attempts: 2,
          window_unmaximize_attempts: 3,
        })
      ).toBe(9)
    })
  })

  // ==========================================================================
  // summarizeQuizFocusEvents()
  // ==========================================================================

  describe('summarizeQuizFocusEvents', () => {
    it('returns empty summary when there are no events', () => {
      expect(summarizeQuizFocusEvents([])).toEqual(emptyQuizFocusSummary())
    })

    it('counts away sessions and computes total away time', () => {
      const result = summarizeQuizFocusEvents([
        { event_type: 'away_start', occurred_at: '2026-02-01T10:00:00.000Z' },
        { event_type: 'away_end', occurred_at: '2026-02-01T10:00:30.000Z' },
        { event_type: 'away_start', occurred_at: '2026-02-01T10:01:00.000Z' },
        { event_type: 'away_end', occurred_at: '2026-02-01T10:01:45.000Z' },
      ])

      expect(result.away_count).toBe(2)
      expect(result.exit_count).toBe(2)
      expect(result.away_total_seconds).toBe(75)
      expect(result.route_exit_attempts).toBe(0)
      expect(result.window_unmaximize_attempts).toBe(0)
      expect(result.last_away_started_at).toBe('2026-02-01T10:01:00.000Z')
      expect(result.last_away_ended_at).toBe('2026-02-01T10:01:45.000Z')
    })

    it('counts route exit attempts independently', () => {
      const result = summarizeQuizFocusEvents([
        { event_type: 'route_exit_attempt', occurred_at: '2026-02-01T10:01:00.000Z' },
        { event_type: 'route_exit_attempt', occurred_at: '2026-02-01T10:02:00.000Z' },
      ])

      expect(result.route_exit_attempts).toBe(2)
      expect(result.exit_count).toBe(2)
      expect(result.window_unmaximize_attempts).toBe(0)
      expect(result.away_count).toBe(0)
      expect(result.away_total_seconds).toBe(0)
    })

    it('counts window unmaximize attempts independently', () => {
      const result = summarizeQuizFocusEvents([
        { event_type: 'window_unmaximize_attempt', occurred_at: '2026-02-01T10:01:00.000Z' },
        { event_type: 'window_unmaximize_attempt', occurred_at: '2026-02-01T10:02:00.000Z' },
      ])

      expect(result.window_unmaximize_attempts).toBe(2)
      expect(result.exit_count).toBe(2)
      expect(result.route_exit_attempts).toBe(0)
      expect(result.away_count).toBe(0)
      expect(result.away_total_seconds).toBe(0)
    })

    it('dedupes mixed exit-like events inside one interruption burst', () => {
      const result = summarizeQuizFocusEvents([
        { event_type: 'away_start', occurred_at: '2026-02-01T10:00:00.000Z' },
        { event_type: 'window_unmaximize_attempt', occurred_at: '2026-02-01T10:00:01.000Z' },
        { event_type: 'route_exit_attempt', occurred_at: '2026-02-01T10:00:01.500Z' },
        { event_type: 'away_end', occurred_at: '2026-02-01T10:00:05.000Z' },
      ])

      expect(result.exit_count).toBe(1)
      expect(result.away_count).toBe(1)
      expect(result.away_total_seconds).toBe(5)
      expect(result.route_exit_attempts).toBe(1)
      expect(result.window_unmaximize_attempts).toBe(1)
    })

    it('starts a new exit after the burst window elapses', () => {
      const result = summarizeQuizFocusEvents([
        { event_type: 'away_start', occurred_at: '2026-02-01T10:00:00.000Z' },
        { event_type: 'away_end', occurred_at: '2026-02-01T10:00:02.000Z' },
        { event_type: 'window_unmaximize_attempt', occurred_at: '2026-02-01T10:00:03.500Z' },
      ])

      expect(result.exit_count).toBe(2)
      expect(result.away_count).toBe(1)
      expect(result.window_unmaximize_attempts).toBe(1)
    })

    it('counts a rapid second away_start after the student returns', () => {
      const result = summarizeQuizFocusEvents([
        { event_type: 'away_start', occurred_at: '2026-02-01T10:00:00.000Z' },
        { event_type: 'away_end', occurred_at: '2026-02-01T10:00:01.000Z' },
        { event_type: 'away_start', occurred_at: '2026-02-01T10:00:01.500Z' },
        { event_type: 'away_end', occurred_at: '2026-02-01T10:00:02.500Z' },
      ])

      expect(result.exit_count).toBe(2)
      expect(result.away_count).toBe(2)
      expect(result.away_total_seconds).toBe(2)
    })

    it('treats events exactly on the burst boundary as one exit', () => {
      const result = summarizeQuizFocusEvents([
        { event_type: 'away_start', occurred_at: '2026-02-01T10:00:00.000Z' },
        { event_type: 'window_unmaximize_attempt', occurred_at: '2026-02-01T10:00:02.000Z' },
      ])

      expect(result.exit_count).toBe(1)
      expect(result.away_count).toBe(1)
      expect(result.window_unmaximize_attempts).toBe(1)
    })

    it('does not increase exit_count on away_end alone', () => {
      const result = summarizeQuizFocusEvents([
        { event_type: 'away_start', occurred_at: '2026-02-01T10:00:00.000Z' },
        { event_type: 'away_end', occurred_at: '2026-02-01T10:00:05.000Z' },
      ])

      expect(result.exit_count).toBe(1)
      expect(result.away_total_seconds).toBe(5)
    })
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildTestAttemptHistoryMetrics,
  isCompleteTestResponseForQuestion,
  normalizeTestResponses,
  validateTestResponsesAgainstQuestions,
} from '@/lib/test-attempts'

describe('test-attempts utilities', () => {
  it('normalizes valid response objects and drops invalid entries', () => {
    const result = normalizeTestResponses({
      'q-2': 1,
      'q-1': 0,
      '': 3,
      'q-3': -1,
      'q-4': 1.5,
      'q-5': '1',
    })

    expect(result).toEqual({
      'q-1': {
        question_type: 'multiple_choice',
        selected_option: 0,
      },
      'q-2': {
        question_type: 'multiple_choice',
        selected_option: 1,
      },
      'q-5': {
        question_type: 'open_response',
        response_text: '1',
      },
    })
  })

  it('preserves legacy object response shapes and normalizes open-response newlines', () => {
    const result = normalizeTestResponses({
      'q-3': {
        response_text: 'Line 1\r\nLine 2',
      },
      'q-1': {
        question_type: 'multiple_choice',
        selected_option: 2,
      },
      'q-2': {
        question_type: 'unknown',
        selected_option: 1,
      },
      'q-4': {
        question_type: 'multiple_choice',
        response_text: 'fallback text',
      },
    })

    expect(result).toEqual({
      'q-1': {
        question_type: 'multiple_choice',
        selected_option: 2,
      },
      'q-2': {
        question_type: 'multiple_choice',
        selected_option: 1,
      },
      'q-3': {
        question_type: 'open_response',
        response_text: 'Line 1\nLine 2',
      },
      'q-4': {
        question_type: 'open_response',
        response_text: 'fallback text',
      },
    })
  })

  it('validates response option ranges and question ids', () => {
    const questions = [
      { id: 'q-1', question_type: 'multiple_choice' as const, options: ['A', 'B'] },
      { id: 'q-2', question_type: 'open_response' as const, options: [], response_max_chars: 50 },
    ]

    expect(
      validateTestResponsesAgainstQuestions(
        {
          'q-1': { question_type: 'multiple_choice', selected_option: 1 },
          'q-2': { question_type: 'open_response', response_text: 'Short response' },
        },
        questions,
        { requireAllQuestions: true }
      )
    ).toEqual({ valid: true })

    expect(
      validateTestResponsesAgainstQuestions(
        { 'q-1': { question_type: 'multiple_choice', selected_option: 3 } },
        questions
      )
    ).toEqual({ valid: false, error: 'Invalid option for question q-1' })

    expect(
      validateTestResponsesAgainstQuestions(
        { 'missing-q': { question_type: 'multiple_choice', selected_option: 0 } },
        questions
      )
    ).toEqual({ valid: false, error: 'Invalid question ID: missing-q' })

    expect(
      validateTestResponsesAgainstQuestions(
        { 'q-1': { question_type: 'multiple_choice', selected_option: 0 } },
        questions,
        { requireAllQuestions: true }
      )
    ).toEqual({ valid: false, error: 'All questions must be answered' })
  })

  it('requires non-blank open responses when all questions must be answered', () => {
    const questions = [
      { id: 'q-1', question_type: 'open_response' as const, options: [], response_max_chars: 50 },
    ]

    expect(
      validateTestResponsesAgainstQuestions(
        {
          'q-1': {
            question_type: 'open_response',
            response_text: '   ',
          },
        },
        questions,
        { requireAllQuestions: true }
      )
    ).toEqual({ valid: false, error: 'All questions must be answered' })
  })

  it('checks whether a response fully answers a question', () => {
    expect(
      isCompleteTestResponseForQuestion(
        { id: 'q-1', question_type: 'multiple_choice', options: ['A', 'B'] },
        { question_type: 'multiple_choice', selected_option: 0 }
      )
    ).toBe(true)

    expect(
      isCompleteTestResponseForQuestion(
        { id: 'q-2', question_type: 'open_response', options: [] },
        { question_type: 'open_response', response_text: '  explanation  ' }
      )
    ).toBe(true)

    expect(
      isCompleteTestResponseForQuestion(
        { id: 'q-3', question_type: 'open_response', options: [] },
        { question_type: 'open_response', response_text: '   ' }
      )
    ).toBe(false)

    expect(
      isCompleteTestResponseForQuestion(
        { id: 'q-4', question_type: 'multiple_choice', options: ['A', 'B'] },
        { question_type: 'open_response', response_text: 'A' }
      )
    ).toBe(false)
  })

  it('builds metrics from response counts', () => {
    const metrics = buildTestAttemptHistoryMetrics(
      {
        'q-1': { question_type: 'multiple_choice', selected_option: 0 },
        'q-2': { question_type: 'open_response', response_text: 'hello world' },
      },
      5.6,
      12.2
    )

    expect(metrics.word_count).toBe(3)
    expect(metrics.char_count).toBeGreaterThan(0)
    expect(metrics.paste_word_count).toBe(6)
    expect(metrics.keystroke_count).toBe(12)
  })
})

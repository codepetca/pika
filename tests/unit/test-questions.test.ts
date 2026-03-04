import { describe, expect, it } from 'vitest'
import { validateTestQuestionCreate, validateTestQuestionUpdate } from '@/lib/test-questions'

describe('test-questions validation', () => {
  it('rejects changing question_type for existing questions', () => {
    const result = validateTestQuestionUpdate(
      { question_type: 'open_response' },
      {
        question_type: 'multiple_choice',
        question_text: 'What is 2 + 2?',
        options: ['3', '4'],
        correct_option: 1,
        points: 1,
        response_max_chars: 5000,
        response_monospace: false,
      }
    )

    expect(result).toEqual({
      valid: false,
      error: 'Question type cannot be changed after creation',
    })
  })

  it('allows editing an existing open response question without changing type', () => {
    const result = validateTestQuestionUpdate(
      {
        question_text: 'Explain event loops briefly.',
        points: 6,
        response_monospace: true,
      },
      {
        question_type: 'open_response',
        question_text: 'Explain event loops.',
        options: [],
        correct_option: null,
        points: 5,
        response_max_chars: 5000,
        response_monospace: false,
      }
    )

    expect(result).toEqual({
      valid: true,
      value: {
        question_type: 'open_response',
        question_text: 'Explain event loops briefly.',
        options: [],
        correct_option: null,
        points: 6,
        response_max_chars: 5000,
        response_monospace: true,
      },
    })
  })

  it('allows empty question text on create when draft option is enabled', () => {
    const result = validateTestQuestionCreate(
      {
        question_type: 'multiple_choice',
        question_text: '   ',
        options: ['Option 1', 'Option 2'],
        correct_option: 0,
        points: 1,
      },
      { allowEmptyQuestionText: true }
    )

    expect(result).toEqual({
      valid: true,
      value: {
        question_type: 'multiple_choice',
        question_text: '',
        options: ['Option 1', 'Option 2'],
        correct_option: 0,
        points: 1,
        response_max_chars: 5000,
        response_monospace: false,
      },
    })
  })

  it('allows clearing question text on update when draft option is enabled', () => {
    const result = validateTestQuestionUpdate(
      { question_text: '   ' },
      {
        question_type: 'open_response',
        question_text: 'Explain event loops.',
        options: [],
        correct_option: null,
        points: 5,
        response_max_chars: 5000,
        response_monospace: false,
      },
      { allowEmptyQuestionText: true }
    )

    expect(result).toEqual({
      valid: true,
      value: {
        question_type: 'open_response',
        question_text: '',
        options: [],
        correct_option: null,
        points: 5,
        response_max_chars: 5000,
        response_monospace: false,
      },
    })
  })
})

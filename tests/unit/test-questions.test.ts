import { describe, expect, it } from 'vitest'
import { validateTestQuestionUpdate } from '@/lib/test-questions'

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
})

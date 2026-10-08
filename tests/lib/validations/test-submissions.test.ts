import { describe, expect, it } from 'vitest'
import {
  saveTestAttemptSchema,
  submitTestResponsesSchema,
} from '@/lib/validations/test-submissions'

describe('submitTestResponsesSchema', () => {
  it('normalizes legacy and typed response values', () => {
    const result = submitTestResponsesSchema.safeParse({
      expected_revision: 1,
      responses: {
        'q-4': { question_type: 'open_response', response_text: 'Typed' },
        'q-3': { selected_option: 2 },
        'q-2': 'Legacy open',
        'q-1': 0,
      },
    })

    expect(result).toEqual({
      success: true,
      data: {
        expectedRevision: 1,
        responses: {
          'q-1': { question_type: 'multiple_choice', selected_option: 0 },
          'q-2': { question_type: 'open_response', response_text: 'Legacy open' },
          'q-3': { question_type: 'multiple_choice', selected_option: 2 },
          'q-4': { question_type: 'open_response', response_text: 'Typed' },
        },
      },
    })
  })

  it.each([null, undefined, [], {}, { expected_revision: 1,
      responses: null }, { expected_revision: 1,
      responses: [] }])(
    'rejects a missing or non-object responses map: %j',
    (input) => {
      const result = submitTestResponsesSchema.safeParse(input)

      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.issues[0]?.message).toBe('Responses are required')
    },
  )
})

describe('saveTestAttemptSchema', () => {
  it('normalizes telemetry and an optional history trigger', () => {
    expect(saveTestAttemptSchema.safeParse({
      expected_revision: 1,
      responses: { q: 0 },
      trigger: 'blur',
      paste_word_count: 2.6,
      keystroke_count: -2,
    })).toEqual({
      success: true,
      data: {
        expectedRevision: 1,
        responses: { q: { question_type: 'multiple_choice', selected_option: 0 } },
        trigger: 'blur',
        pasteWordCount: 3,
        keystrokeCount: 0,
      },
    })
  })

  it.each([undefined, null, 0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1])('rejects invalid revision %j', (revision) => {
    expect(saveTestAttemptSchema.safeParse({ responses: {}, expected_revision: revision }).success).toBe(false)
    expect(submitTestResponsesSchema.safeParse({ responses: {}, expected_revision: revision }).success).toBe(false)
  })

  it('rejects unsupported history triggers', () => {
    const result = saveTestAttemptSchema.safeParse({ expected_revision: 1, responses: {}, trigger: 'submit' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.message).toBe('Invalid trigger')
  })
})

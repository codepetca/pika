import { describe, expect, it } from 'vitest'
import { allowsTestQuestionChanges } from '@/lib/test-editing-policy'
import type { TestDraftQuestion } from '@/types'

const question: TestDraftQuestion = {
  id: '11111111-1111-4111-8111-111111111111', question_type: 'multiple_choice',
  question_text: 'Choose an anser.', options: ['One', 'Two', 'Three', 'Four'],
  correct_option: 0, points: 1, answer_key: null, sample_solution: null,
  response_max_chars: 5000, response_monospace: false,
}
const locked = { structureLocked: true }

describe('post-start test question policy', () => {
  it('allows prompt wording and instructions while preserving every other field', () => {
    expect(allowsTestQuestionChanges([question], [{ ...question, question_text: 'Choose an answer. Explain your reasoning.' }], locked)).toBe(true)
  })
  it.each([
    ['a fifth choice', { options: [...question.options, 'Five'] }],
    ['a removed choice', { options: question.options.slice(1) }],
    ['reordered choices', { options: [...question.options].reverse() }],
    ['same-count replacement', { options: ['Replacement', 'Two', 'Three', 'Four'] }],
    ['question identity', { id: '22222222-2222-4222-8222-222222222222' }],
    ['type', { question_type: 'open_response' }],
    ['correct answer', { correct_option: 1 }],
    ['answer key', { answer_key: 'New rubric' }],
    ['sample solution', { sample_solution: 'New solution' }],
    ['points', { points: 2 }],
    ['response length', { response_max_chars: 100 }],
    ['response format', { response_monospace: true }],
  ])('blocks changes to %s', (_name, change) => {
    const next = [{ ...question, ...change }] as TestDraftQuestion[]
    expect(allowsTestQuestionChanges([question], next, locked)).toBe(false)
    expect(allowsTestQuestionChanges([question], next, { structureLocked: false })).toBe(true)
  })
  it('blocks adding, deleting and reordering questions', () => {
    const second = { ...question, id: '22222222-2222-4222-8222-222222222222' }
    expect(allowsTestQuestionChanges([question], [], locked)).toBe(false)
    expect(allowsTestQuestionChanges([question], [question, second], locked)).toBe(false)
    expect(allowsTestQuestionChanges([question, second], [second, question], locked)).toBe(false)
  })
})

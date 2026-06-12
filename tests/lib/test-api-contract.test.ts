import { describe, expect, it } from 'vitest'
import { withLegacyQuizKey, withLegacyQuizListKey } from '@/lib/test-api-contract'

describe('test API compatibility contract', () => {
  it('mirrors the current tests list under the legacy quizzes key', () => {
    const tests = [{ id: 'test-1' }, { id: 'test-2' }]

    const payload = withLegacyQuizListKey(tests)

    expect(payload).toEqual({ tests, quizzes: tests })
    expect(payload.quizzes).toBe(payload.tests)
  })

  it('mirrors the current test detail under the legacy quiz key', () => {
    const test = { id: 'test-1' }

    const payload = withLegacyQuizKey(test)

    expect(payload).toEqual({ test, quiz: test })
    expect(payload.quiz).toBe(payload.test)
  })
})

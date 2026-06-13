import { describe, expect, it } from 'vitest'
import {
  readTestFromPayload,
  readTestsFromPayload,
  withLegacyQuizKey,
  withLegacyQuizListKey,
} from '@/lib/test-api-contract'

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

  it('reads the current tests list before the legacy quizzes key', () => {
    const currentTests = [{ id: 'test-current' }]
    const legacyTests = [{ id: 'test-legacy' }]

    expect(readTestsFromPayload({ tests: currentTests, quizzes: legacyTests })).toBe(currentTests)
  })

  it('falls back to the legacy quizzes key for older list payloads', () => {
    const legacyTests = [{ id: 'test-legacy' }]

    expect(readTestsFromPayload({ quizzes: legacyTests })).toBe(legacyTests)
    expect(readTestsFromPayload(null)).toEqual([])
  })

  it('reads the current test detail before the legacy quiz key', () => {
    const currentTest = { id: 'test-current' }
    const legacyTest = { id: 'test-legacy' }

    expect(readTestFromPayload({ test: currentTest, quiz: legacyTest })).toBe(currentTest)
  })

  it('falls back to the legacy quiz key for older detail payloads', () => {
    const legacyTest = { id: 'test-legacy' }

    expect(readTestFromPayload({ quiz: legacyTest })).toBe(legacyTest)
    expect(readTestFromPayload(undefined)).toBeUndefined()
  })
})

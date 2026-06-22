import { describe, expect, it } from 'vitest'
import {
  readTeacherTestResultsFromPayload,
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

  it('normalizes teacher test results from the current test key first', () => {
    const currentTest = { id: 'test-current', status: 'active' } as any
    const legacyTest = { id: 'test-legacy', status: 'closed' } as any
    const students = [
      {
        student_id: 'student-1',
        name: 'Alice Zephyr',
        first_name: 'Alice',
        last_name: 'Zephyr',
        email: 'alice@example.com',
        status: 'submitted',
        submitted_at: null,
        last_activity_at: null,
        points_earned: 3,
        points_possible: 5,
        percent: 60,
        graded_open_responses: 1,
        ungraded_open_responses: 0,
        focus_summary: null,
      },
    ] as any
    const activeRun = { id: 'run-1', test_id: 'test-current', status: 'running' } as any

    const result = readTeacherTestResultsFromPayload({
      test: currentTest,
      quiz: legacyTest,
      students,
      questions: [
        { id: 'q-open', question_type: 'open_response', response_monospace: true },
        { id: 'q-choice', question_type: 'multiple_choice', response_monospace: false },
      ],
      active_ai_grading_run: activeRun,
    })

    expect(result.test).toBe(currentTest)
    expect(result.testStatus).toBe('active')
    expect(result.students).toBe(students)
    expect(result.questions).toEqual([
      { id: 'q-open', questionType: 'open_response', responseMonospace: true },
      { id: 'q-choice', questionType: 'multiple_choice', responseMonospace: false },
    ])
    expect(result.activeAiGradingRun).toBe(activeRun)
  })

  it('normalizes teacher test results from the legacy quiz fallback', () => {
    const legacyTest = { id: 'test-legacy', status: 'closed' } as any

    const result = readTeacherTestResultsFromPayload({
      quiz: legacyTest,
      error: 'No results',
    })

    expect(result.test).toBe(legacyTest)
    expect(result.testStatus).toBe('closed')
    expect(result.students).toEqual([])
    expect(result.questions).toEqual([])
    expect(result.activeAiGradingRun).toBeNull()
    expect(result.error).toBe('No results')
  })

  it('drops unknown teacher test result statuses while preserving the payload test', () => {
    const test = { id: 'test-1', status: 'archived' } as any

    const result = readTeacherTestResultsFromPayload({ test })

    expect(result.test).toBe(test)
    expect(result.testStatus).toBeNull()
  })
})

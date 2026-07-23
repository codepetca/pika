import { describe, expect, it } from 'vitest'
import {
  readTeacherTestResultsFromPayload,
  readTestFromPayload,
  readTestsFromPayload,
} from '@/lib/test-api-contract'

describe('test API contract', () => {
  it('reads the tests list and defaults missing lists to empty', () => {
    const tests = [{ id: 'test-1' }, { id: 'test-2' }]

    expect(readTestsFromPayload({ tests })).toBe(tests)
    expect(readTestsFromPayload(null)).toEqual([])
  })

  it('reads the test detail and defaults missing details to undefined', () => {
    const test = { id: 'test-1' }

    expect(readTestFromPayload({ test })).toBe(test)
    expect(readTestFromPayload(undefined)).toBeUndefined()
  })

  it('normalizes teacher test results from the test key', () => {
    const currentTest = { id: 'test-current', status: 'active' } as any
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

  it('normalizes a missing teacher test result', () => {
    const result = readTeacherTestResultsFromPayload({ error: 'No results' })

    expect(result.test).toBeUndefined()
    expect(result.testStatus).toBeNull()
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

import { describe, expect, it } from 'vitest'
import { classifyTestAiGradeResponse } from '@/lib/test-ai-grading-scope'

describe('classifyTestAiGradeResponse', () => {
  it('skips persisted grades when grading only ungraded responses', () => {
    expect(classifyTestAiGradeResponse({
      gradeScope: 'ungraded',
      responseText: 'A complete response',
      hasPersistedGrade: true,
    })).toBe('already_graded')
  })

  it('queues persisted grades when regrading all responses', () => {
    expect(classifyTestAiGradeResponse({
      gradeScope: 'all',
      responseText: 'A complete response',
      hasPersistedGrade: true,
    })).toBe('queue')
  })

  it('does not queue blank responses even when regrading all', () => {
    expect(classifyTestAiGradeResponse({
      gradeScope: 'all',
      responseText: '   ',
      hasPersistedGrade: false,
    })).toBe('unanswered')
    expect(classifyTestAiGradeResponse({
      gradeScope: 'all',
      responseText: null,
      hasPersistedGrade: true,
    })).toBe('already_graded')
  })
})

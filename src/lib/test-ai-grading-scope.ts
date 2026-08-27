export type TestAiGradeScope = 'ungraded' | 'all'

export type TestAiGradeResponseDisposition = 'queue' | 'unanswered' | 'already_graded'

export function classifyTestAiGradeResponse(input: {
  gradeScope: TestAiGradeScope
  responseText: string | null
  hasPersistedGrade: boolean
}): TestAiGradeResponseDisposition {
  if (!input.responseText?.trim()) {
    return input.hasPersistedGrade ? 'already_graded' : 'unanswered'
  }

  if (input.gradeScope === 'ungraded' && input.hasPersistedGrade) {
    return 'already_graded'
  }

  return 'queue'
}

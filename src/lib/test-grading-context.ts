import { z } from 'zod'

export const testQuestionGradingSnapshotSchema = z.object({
  test_title: z.string(),
  question_text: z.string(),
  points: z.number().finite().nullable(),
  response_monospace: z.boolean().nullable(),
  answer_key: z.string().nullable(),
  sample_solution: z.string().nullable(),
}).strict()

export type TestQuestionGradingSnapshot = z.infer<typeof testQuestionGradingSnapshotSchema>

export function buildTestQuestionGradingSnapshot(input: {
  testTitle: string
  question: {
    question_text: string
    points: number | null
    response_monospace: boolean | null
    answer_key: string | null
    sample_solution: string | null
  }
}): TestQuestionGradingSnapshot {
  return {
    test_title: input.testTitle,
    question_text: input.question.question_text,
    points: input.question.points,
    response_monospace: input.question.response_monospace,
    answer_key: input.question.answer_key,
    sample_solution: input.question.sample_solution,
  }
}

export function hasPersistedTestResponseGrade(response: {
  graded_at: string | null
  score: number | null
  feedback: string | null
}): boolean {
  return response.graded_at !== null || response.score !== null || response.feedback !== null
}

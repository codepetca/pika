export const TEST_CORRECTIONS_MESSAGE =
  'A student has started. You can correct question wording, instructions, and existing choice text. Question order, choice count, marked answers, grading, and response settings are locked.'

export type TestEditingPolicy = { structureLocked: boolean }

type TestPolicyQuestion = {
  id: string
  question_type?: string
  options: string[]
  correct_option?: number | null
  answer_key?: string | null
  sample_solution?: string | null
  points?: number
  response_max_chars?: number
  response_monospace?: boolean
}

/** Ordered identities matter: responses point at a question row and choice index. */
export function allowsTestQuestionChanges(
  current: TestPolicyQuestion[],
  next: TestPolicyQuestion[],
  policy: TestEditingPolicy,
): boolean {
  if (!policy.structureLocked) return true
  if (current.length !== next.length) return false
  return current.every((question, index) => {
    const candidate = next[index]
    return question.id === candidate.id
      && question.question_type === candidate.question_type
      && (question.question_type === 'multiple_choice'
        ? question.options.length === candidate.options.length
        : JSON.stringify(question.options) === JSON.stringify(candidate.options))
      && question.correct_option === candidate.correct_option
      && question.answer_key === candidate.answer_key
      && question.sample_solution === candidate.sample_solution
      && question.points === candidate.points
      && question.response_max_chars === candidate.response_max_chars
      && question.response_monospace === candidate.response_monospace
  })
}

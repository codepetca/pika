export type TestResponses = Record<string, number>

type QuestionOptionSet = {
  id: string
  options: unknown[]
}

export function normalizeTestResponses(input: unknown): TestResponses {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {}
  }

  const entries = Object.entries(input as Record<string, unknown>)
    .filter(([questionId, selectedOption]) => {
      return (
        questionId.trim().length > 0 &&
        typeof selectedOption === 'number' &&
        Number.isInteger(selectedOption) &&
        selectedOption >= 0
      )
    })
    .sort(([a], [b]) => a.localeCompare(b))

  return Object.fromEntries(entries) as TestResponses
}

export function validateTestResponsesAgainstQuestions(
  responses: TestResponses,
  questions: QuestionOptionSet[],
  options?: { requireAllQuestions?: boolean }
): { valid: boolean; error?: string } {
  const questionById = new Map(questions.map((q) => [q.id, q]))
  const responseQuestionIds = Object.keys(responses)

  for (const questionId of responseQuestionIds) {
    const question = questionById.get(questionId)
    if (!question) {
      return { valid: false, error: `Invalid question ID: ${questionId}` }
    }

    const selectedOption = responses[questionId]
    if (
      typeof selectedOption !== 'number' ||
      !Number.isInteger(selectedOption) ||
      selectedOption < 0 ||
      selectedOption >= question.options.length
    ) {
      return { valid: false, error: `Invalid option for question ${questionId}` }
    }
  }

  if (options?.requireAllQuestions) {
    const missingQuestion = questions.find((q) => responses[q.id] === undefined)
    if (missingQuestion) {
      return { valid: false, error: 'All questions must be answered' }
    }
  }

  return { valid: true }
}

export function buildTestAttemptHistoryMetrics(
  responses: TestResponses,
  pasteWordCount = 0,
  keystrokeCount = 0
) {
  const safePaste = Math.max(0, Math.round(pasteWordCount))
  const safeKeystrokes = Math.max(0, Math.round(keystrokeCount))

  return {
    word_count: Object.keys(responses).length,
    char_count: JSON.stringify(responses).length,
    paste_word_count: safePaste,
    keystroke_count: safeKeystrokes,
  }
}

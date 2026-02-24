import type { TestQuestionType, TestResponseDraftValue } from '@/types'

export const DEFAULT_OPEN_RESPONSE_MAX_CHARS = 5000

export type TestResponses = Record<string, TestResponseDraftValue>

type QuestionOptionSet = {
  id: string
  question_type?: TestQuestionType | null
  options: unknown[]
  response_max_chars?: number | null
}

function normalizeOpenResponseText(raw: string): string {
  return raw.replace(/\r\n/g, '\n')
}

function parseResponseValue(raw: unknown): TestResponseDraftValue | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) {
    return {
      question_type: 'multiple_choice',
      selected_option: raw,
    }
  }

  if (typeof raw === 'string') {
    return {
      question_type: 'open_response',
      response_text: normalizeOpenResponseText(raw),
    }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const rawRecord = raw as Record<string, unknown>
  if (
    rawRecord.question_type === 'multiple_choice' &&
    typeof rawRecord.selected_option === 'number' &&
    Number.isInteger(rawRecord.selected_option) &&
    rawRecord.selected_option >= 0
  ) {
    return {
      question_type: 'multiple_choice',
      selected_option: rawRecord.selected_option,
    }
  }

  if (
    rawRecord.question_type === 'open_response' &&
    typeof rawRecord.response_text === 'string'
  ) {
    return {
      question_type: 'open_response',
      response_text: normalizeOpenResponseText(rawRecord.response_text),
    }
  }

  if (
    typeof rawRecord.selected_option === 'number' &&
    Number.isInteger(rawRecord.selected_option) &&
    rawRecord.selected_option >= 0
  ) {
    return {
      question_type: 'multiple_choice',
      selected_option: rawRecord.selected_option,
    }
  }

  if (typeof rawRecord.response_text === 'string') {
    return {
      question_type: 'open_response',
      response_text: normalizeOpenResponseText(rawRecord.response_text),
    }
  }

  return null
}

function getQuestionType(question: QuestionOptionSet): TestQuestionType {
  return question.question_type === 'open_response' ? 'open_response' : 'multiple_choice'
}

export function normalizeTestResponses(input: unknown): TestResponses {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {}
  }

  const entries = Object.entries(input as Record<string, unknown>)
    .map(([questionId, rawValue]) => {
      const normalized = parseResponseValue(rawValue)
      if (!questionId.trim() || !normalized) return null
      return [questionId, normalized] as const
    })
    .filter((entry): entry is readonly [string, TestResponseDraftValue] => entry !== null)
    .sort(([a], [b]) => a.localeCompare(b))

  return Object.fromEntries(entries)
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

    const response = responses[questionId]
    const questionType = getQuestionType(question)
    const maxChars = Math.max(1, Math.floor(question.response_max_chars ?? DEFAULT_OPEN_RESPONSE_MAX_CHARS))

    if (questionType === 'multiple_choice') {
      if (response.question_type !== 'multiple_choice') {
        return { valid: false, error: `Invalid response type for question ${questionId}` }
      }
      if (
        !Number.isInteger(response.selected_option) ||
        response.selected_option < 0 ||
        response.selected_option >= question.options.length
      ) {
        return { valid: false, error: `Invalid option for question ${questionId}` }
      }
      continue
    }

    if (response.question_type !== 'open_response') {
      return { valid: false, error: `Invalid response type for question ${questionId}` }
    }

    if (response.response_text.length > maxChars) {
      return { valid: false, error: `Response is too long for question ${questionId}` }
    }
  }

  if (options?.requireAllQuestions) {
    for (const question of questions) {
      const response = responses[question.id]
      if (!response) {
        return { valid: false, error: 'All questions must be answered' }
      }

      const questionType = getQuestionType(question)
      if (questionType === 'open_response') {
        if (response.question_type !== 'open_response' || !response.response_text.trim()) {
          return { valid: false, error: 'All questions must be answered' }
        }
      } else if (response.question_type !== 'multiple_choice') {
        return { valid: false, error: 'All questions must be answered' }
      }
    }
  }

  return { valid: true }
}

function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

export function buildTestAttemptHistoryMetrics(
  responses: TestResponses,
  pasteWordCount = 0,
  keystrokeCount = 0
) {
  const safePaste = Math.max(0, Math.round(pasteWordCount))
  const safeKeystrokes = Math.max(0, Math.round(keystrokeCount))

  const responseValues = Object.values(responses)
  const mcCount = responseValues.filter((response) => response.question_type === 'multiple_choice').length
  const openTextWordCount = responseValues
    .filter((response): response is Extract<TestResponseDraftValue, { question_type: 'open_response' }> => response.question_type === 'open_response')
    .reduce((acc, response) => acc + countWords(response.response_text), 0)

  return {
    word_count: mcCount + openTextWordCount,
    char_count: JSON.stringify(responses).length,
    paste_word_count: safePaste,
    keystroke_count: safeKeystrokes,
  }
}

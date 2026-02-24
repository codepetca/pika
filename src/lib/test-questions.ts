import { MAX_QUIZ_OPTIONS } from '@/lib/quizzes'
import { DEFAULT_OPEN_RESPONSE_MAX_CHARS } from '@/lib/test-attempts'
import type { TestQuestionType } from '@/types'

export const DEFAULT_MULTIPLE_CHOICE_POINTS = 1
export const DEFAULT_OPEN_RESPONSE_POINTS = 5

export type TestQuestionDraft = {
  question_type: TestQuestionType
  question_text: string
  options: string[]
  correct_option: number | null
  points: number
  response_max_chars: number
}

type ValidationResult =
  | { valid: true; value: TestQuestionDraft }
  | { valid: false; error: string }

function normalizeQuestionType(input: unknown): TestQuestionType {
  return input === 'open_response' ? 'open_response' : 'multiple_choice'
}

function normalizePoints(input: unknown, fallback: number): number | null {
  if (input === undefined || input === null || input === '') return fallback
  const parsed = Number(input)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.round(parsed * 100) / 100
}

function normalizeResponseMaxChars(input: unknown, fallback = DEFAULT_OPEN_RESPONSE_MAX_CHARS): number | null {
  if (input === undefined || input === null || input === '') return fallback
  const parsed = Number(input)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20000) return null
  return parsed
}

function normalizeQuestionText(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  return trimmed ? trimmed : null
}

function normalizeOptions(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null
  const options = input
    .map((option) => (typeof option === 'string' ? option.trim() : ''))
    .filter((option) => option.length > 0)

  if (options.length !== input.length) return null
  return options
}

export function defaultPointsForQuestionType(questionType: TestQuestionType): number {
  return questionType === 'open_response'
    ? DEFAULT_OPEN_RESPONSE_POINTS
    : DEFAULT_MULTIPLE_CHOICE_POINTS
}

export function validateTestQuestionCreate(input: Record<string, unknown>): ValidationResult {
  const questionType = normalizeQuestionType(input.question_type)
  const questionText = normalizeQuestionText(input.question_text)
  if (!questionText) {
    return { valid: false, error: 'Question text is required' }
  }

  const points = normalizePoints(input.points, defaultPointsForQuestionType(questionType))
  if (points === null) {
    return { valid: false, error: 'Points must be greater than 0' }
  }

  const responseMaxChars = normalizeResponseMaxChars(input.response_max_chars)
  if (responseMaxChars === null) {
    return { valid: false, error: 'response_max_chars must be an integer between 1 and 20000' }
  }

  if (questionType === 'open_response') {
    return {
      valid: true,
      value: {
        question_type: 'open_response',
        question_text: questionText,
        options: [],
        correct_option: null,
        points,
        response_max_chars: responseMaxChars,
      },
    }
  }

  const options = normalizeOptions(input.options)
  if (!options) {
    return { valid: false, error: 'Options must be an array of non-empty strings' }
  }
  if (options.length < 2) {
    return { valid: false, error: 'At least 2 options are required' }
  }
  if (options.length > MAX_QUIZ_OPTIONS) {
    return { valid: false, error: `Maximum ${MAX_QUIZ_OPTIONS} options allowed` }
  }

  const rawCorrectOption = input.correct_option
  if (!Number.isInteger(rawCorrectOption)) {
    return { valid: false, error: 'correct_option is required for multiple-choice questions' }
  }
  const correctOption = Number(rawCorrectOption)
  if (correctOption < 0 || correctOption >= options.length) {
    return { valid: false, error: 'correct_option is out of range' }
  }

  return {
    valid: true,
    value: {
      question_type: 'multiple_choice',
      question_text: questionText,
      options,
      correct_option: correctOption,
      points,
      response_max_chars: responseMaxChars,
    },
  }
}

export function validateTestQuestionUpdate(
  input: Record<string, unknown>,
  current: TestQuestionDraft
): ValidationResult {
  const nextType = normalizeQuestionType(input.question_type ?? current.question_type)
  const nextText = normalizeQuestionText(input.question_text ?? current.question_text)
  if (!nextText) {
    return { valid: false, error: 'Question text cannot be empty' }
  }

  const nextPoints = normalizePoints(input.points, current.points)
  if (nextPoints === null) {
    return { valid: false, error: 'Points must be greater than 0' }
  }

  const nextMaxChars = normalizeResponseMaxChars(input.response_max_chars, current.response_max_chars)
  if (nextMaxChars === null) {
    return { valid: false, error: 'response_max_chars must be an integer between 1 and 20000' }
  }

  if (nextType === 'open_response') {
    return {
      valid: true,
      value: {
        question_type: 'open_response',
        question_text: nextText,
        options: [],
        correct_option: null,
        points: nextPoints,
        response_max_chars: nextMaxChars,
      },
    }
  }

  let nextOptions = current.options
  if (input.options !== undefined) {
    const normalized = normalizeOptions(input.options)
    if (!normalized) {
      return { valid: false, error: 'Options must be an array of non-empty strings' }
    }
    nextOptions = normalized
  }

  if (nextOptions.length < 2) {
    return { valid: false, error: 'At least 2 options are required' }
  }
  if (nextOptions.length > MAX_QUIZ_OPTIONS) {
    return { valid: false, error: `Maximum ${MAX_QUIZ_OPTIONS} options allowed` }
  }

  const currentCorrectOption =
    typeof current.correct_option === 'number' && Number.isInteger(current.correct_option)
      ? current.correct_option
      : 0
  const correctOptionCandidate = input.correct_option ?? currentCorrectOption
  if (!Number.isInteger(correctOptionCandidate)) {
    return { valid: false, error: 'correct_option must be an integer' }
  }
  const nextCorrectOption = Number(correctOptionCandidate)
  if (nextCorrectOption < 0 || nextCorrectOption >= nextOptions.length) {
    return { valid: false, error: 'correct_option is out of range' }
  }

  return {
    valid: true,
    value: {
      question_type: 'multiple_choice',
      question_text: nextText,
      options: nextOptions,
      correct_option: nextCorrectOption,
      points: nextPoints,
      response_max_chars: nextMaxChars,
    },
  }
}

export function isOpenResponseQuestion(question: { question_type?: TestQuestionType | null }): boolean {
  return question.question_type === 'open_response'
}


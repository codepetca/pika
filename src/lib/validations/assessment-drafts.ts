import { validateAssessmentOptions } from '@/lib/assessments'
import { validateTestQuestionCreate } from '@/lib/test-questions'
import type {
  AssessmentDraftContent,
  AssessmentDraftQuestion,
  TestDraftContent,
  TestDraftQuestion,
} from '@/types'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type AssessmentDraftValidationResult<TContent> =
  | { valid: true; value: TContent }
  | { valid: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return UUID_RE.test(value) ? value : null
}

function parseTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null

  const next: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return null
    const trimmed = item.trim()
    if (!trimmed) return null
    next.push(trimmed)
  }

  return next
}

function parseBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function parseOptionalMarkdown(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return undefined
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function ensureUniqueQuestionIds<TQuestion extends { id: string }>(
  questions: TQuestion[],
): string | null {
  const ids = new Set<string>()
  for (const question of questions) {
    if (ids.has(question.id)) {
      return `Duplicate question id: ${question.id}`
    }
    ids.add(question.id)
  }
  return null
}

export function validateAssessmentDraftContent(
  input: unknown,
): AssessmentDraftValidationResult<AssessmentDraftContent> {
  if (!isRecord(input)) return { valid: false, error: 'Invalid draft content' }

  const title = parseTitle(input.title)
  if (!title) return { valid: false, error: 'Title is required' }

  const showResults = parseBoolean(input.show_results)
  if (showResults === null) {
    return { valid: false, error: 'show_results must be a boolean' }
  }

  if (!Array.isArray(input.questions)) {
    return { valid: false, error: 'questions must be an array' }
  }

  const questions: AssessmentDraftQuestion[] = []

  for (let index = 0; index < input.questions.length; index += 1) {
    const rawQuestion = input.questions[index]
    if (!isRecord(rawQuestion)) {
      return { valid: false, error: `Q${index + 1}: Invalid question` }
    }

    const id = parseUuid(rawQuestion.id)
    if (!id) {
      return { valid: false, error: `Q${index + 1}: Invalid question id` }
    }

    const questionText = parseTitle(rawQuestion.question_text)
    if (!questionText) {
      return { valid: false, error: `Q${index + 1}: Question text is required` }
    }

    const options = parseStringArray(rawQuestion.options)
    if (!options) {
      return { valid: false, error: `Q${index + 1}: Options must be non-empty strings` }
    }

    const optionsValidation = validateAssessmentOptions(options)
    if (!optionsValidation.valid) {
      return { valid: false, error: `Q${index + 1}: ${optionsValidation.error}` }
    }

    questions.push({
      id,
      question_text: questionText,
      options,
    })
  }

  const duplicateError = ensureUniqueQuestionIds(questions)
  if (duplicateError) {
    return { valid: false, error: duplicateError }
  }

  return {
    valid: true,
    value: {
      title,
      show_results: showResults,
      questions,
      ...(input.source_format === 'markdown' ? { source_format: 'markdown' as const } : {}),
      ...(parseOptionalMarkdown(input.source_markdown) !== undefined
        ? { source_markdown: parseOptionalMarkdown(input.source_markdown) }
        : {}),
    },
  }
}

export function validateTestDraftContent(
  input: unknown,
  options?: { allowEmptyQuestionText?: boolean },
): AssessmentDraftValidationResult<TestDraftContent> {
  if (!isRecord(input)) return { valid: false, error: 'Invalid draft content' }

  const title = parseTitle(input.title)
  if (!title) return { valid: false, error: 'Title is required' }

  const showResults = parseBoolean(input.show_results)
  if (showResults === null) {
    return { valid: false, error: 'show_results must be a boolean' }
  }

  if (!Array.isArray(input.questions)) {
    return { valid: false, error: 'questions must be an array' }
  }

  const questions: TestDraftQuestion[] = []

  for (let index = 0; index < input.questions.length; index += 1) {
    const rawQuestion = input.questions[index]
    if (!isRecord(rawQuestion)) {
      return { valid: false, error: `Q${index + 1}: Invalid question` }
    }

    const id = parseUuid(rawQuestion.id)
    if (!id) {
      return { valid: false, error: `Q${index + 1}: Invalid question id` }
    }

    const validation = validateTestQuestionCreate(rawQuestion, {
      allowEmptyQuestionText: options?.allowEmptyQuestionText === true,
    })

    if (!validation.valid) {
      return { valid: false, error: `Q${index + 1}: ${validation.error}` }
    }

    questions.push({
      id,
      ...validation.value,
    })
  }

  const duplicateError = ensureUniqueQuestionIds(questions)
  if (duplicateError) {
    return { valid: false, error: duplicateError }
  }

  return {
    valid: true,
    value: {
      title,
      show_results: showResults,
      questions,
      ...(input.source_format === 'markdown' ? { source_format: 'markdown' as const } : {}),
      ...(parseOptionalMarkdown(input.source_markdown) !== undefined
        ? { source_markdown: parseOptionalMarkdown(input.source_markdown) }
        : {}),
    },
  }
}

import { isVisibleAtNow } from '@/lib/scheduling'
import type {
  StudentSurveyStatus,
  Survey,
  SurveyQuestion,
  SurveyQuestionResult,
  SurveyQuestionType,
  SurveyResponse,
  SurveyResponseValue,
  SurveyStatus,
} from '@/types'

export const MAX_SURVEY_OPTIONS = 6
export const DEFAULT_SURVEY_TEXT_MAX_CHARS = 500
export const DEFAULT_SURVEY_LINK_MAX_CHARS = 2048

export function getSurveyStatusLabel(status: SurveyStatus): string {
  const labels: Record<SurveyStatus, string> = {
    draft: 'Draft',
    active: 'Open',
    closed: 'Closed',
  }
  return labels[status]
}

export function getSurveyStatusBadgeClass(status: SurveyStatus): string {
  const classes: Record<SurveyStatus, string> = {
    draft: 'bg-surface-2 text-text-muted',
    active: 'bg-success-bg text-success',
    closed: 'bg-danger-bg text-danger',
  }
  return classes[status]
}

export function isSurveyVisibleToStudents(
  survey: Pick<Survey, 'status' | 'opens_at'>,
  now: Date = new Date()
): boolean {
  if (survey.status !== 'active') return false
  return isVisibleAtNow(survey.opens_at, now)
}

export function hasSurveyOpened(
  survey: Pick<Survey, 'status' | 'opens_at'>,
  now: Date = new Date()
): boolean {
  return survey.status === 'active' && isVisibleAtNow(survey.opens_at, now)
}

export function canStudentRespondToSurvey(
  survey: Pick<Survey, 'status' | 'opens_at' | 'dynamic_responses'>,
  hasResponded: boolean,
  now: Date = new Date()
): boolean {
  if (!isSurveyVisibleToStudents(survey, now)) return false
  if (!hasResponded) return true
  return survey.dynamic_responses
}

export function getStudentSurveyStatus(
  survey: Pick<Survey, 'status' | 'opens_at' | 'show_results' | 'dynamic_responses'>,
  hasResponded: boolean,
  now: Date = new Date()
): StudentSurveyStatus {
  if (!hasResponded) return 'not_started'
  if (canStudentRespondToSurvey(survey, hasResponded, now)) return 'can_update'
  if (survey.show_results) return 'can_view_results'
  return 'responded'
}

export function canActivateSurvey(
  survey: Pick<Survey, 'status'>,
  questionsCount: number
): { valid: boolean; error?: string } {
  if (survey.status !== 'draft') {
    return { valid: false, error: 'Only draft surveys can be opened' }
  }
  if (questionsCount < 1) {
    return { valid: false, error: 'Survey must have at least 1 question' }
  }
  return { valid: true }
}

export function normalizeSurveyQuestionType(value: unknown): SurveyQuestionType | null {
  if (value === 'multiple_choice' || value === 'short_text' || value === 'link') return value
  return null
}

export function validateSurveyOptions(options: string[]): { valid: boolean; error?: string } {
  if (options.length < 2) return { valid: false, error: 'At least 2 options required' }
  if (options.length > MAX_SURVEY_OPTIONS) {
    return { valid: false, error: `Maximum ${MAX_SURVEY_OPTIONS} options allowed` }
  }
  if (options.some((option) => !option.trim())) {
    return { valid: false, error: 'Options cannot be empty' }
  }
  return { valid: true }
}

export function normalizeSurveyQuestionInput(input: {
  question_type?: unknown
  question_text?: unknown
  options?: unknown
  response_max_chars?: unknown
}): { valid: true; question: Pick<SurveyQuestion, 'question_type' | 'question_text' | 'options' | 'response_max_chars'> } | { valid: false; error: string } {
  const questionType = normalizeSurveyQuestionType(input.question_type ?? 'multiple_choice')
  if (!questionType) return { valid: false, error: 'Invalid question type' }

  const questionText = typeof input.question_text === 'string' ? input.question_text.trim() : ''
  if (!questionText) return { valid: false, error: 'Question text is required' }

  const responseMaxChars =
    typeof input.response_max_chars === 'number' && Number.isFinite(input.response_max_chars)
      ? Math.max(1, Math.min(5000, Math.floor(input.response_max_chars)))
      : questionType === 'link'
        ? DEFAULT_SURVEY_LINK_MAX_CHARS
        : DEFAULT_SURVEY_TEXT_MAX_CHARS

  if (questionType === 'multiple_choice') {
    if (!Array.isArray(input.options)) return { valid: false, error: 'Options must be an array' }
    const options = input.options
      .map((option) => (typeof option === 'string' ? option.trim() : ''))
      .filter(Boolean)
    const optionsValidation = validateSurveyOptions(options)
    if (!optionsValidation.valid) {
      return { valid: false, error: optionsValidation.error || 'Invalid options' }
    }
    return {
      valid: true,
      question: {
        question_type: 'multiple_choice',
        question_text: questionText,
        options,
        response_max_chars: responseMaxChars,
      },
    }
  }

  return {
    valid: true,
    question: {
      question_type: questionType,
      question_text: questionText,
      options: [],
      response_max_chars: responseMaxChars,
    },
  }
}

export function normalizeSurveyUrl(rawValue: string): string | null {
  const value = rawValue.trim()
  if (!value) return null

  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

export function validateSurveyResponses(
  questions: SurveyQuestion[],
  responses: Record<string, unknown>
): { valid: true; responses: Record<string, SurveyResponseValue> } | { valid: false; error: string } {
  const questionById = new Map(questions.map((question) => [question.id, question]))
  const responseQuestionIds = Object.keys(responses)

  for (const questionId of responseQuestionIds) {
    if (!questionById.has(questionId)) {
      return { valid: false, error: `Invalid question ID: ${questionId}` }
    }
  }

  for (const question of questions) {
    if (!responseQuestionIds.includes(question.id)) {
      return { valid: false, error: 'All questions must be answered' }
    }
  }

  const normalized: Record<string, SurveyResponseValue> = {}

  for (const question of questions) {
    const rawValue = responses[question.id]
    const maxChars = Math.max(1, Math.floor(question.response_max_chars || DEFAULT_SURVEY_TEXT_MAX_CHARS))

    if (question.question_type === 'multiple_choice') {
      const selectedOption =
        typeof rawValue === 'number'
          ? rawValue
          : rawValue &&
              typeof rawValue === 'object' &&
              (rawValue as { question_type?: unknown }).question_type === 'multiple_choice'
            ? (rawValue as { selected_option?: unknown }).selected_option
            : null

      if (
        typeof selectedOption !== 'number' ||
        !Number.isInteger(selectedOption) ||
        selectedOption < 0 ||
        selectedOption >= question.options.length
      ) {
        return { valid: false, error: `Invalid option for question ${question.id}` }
      }

      normalized[question.id] = {
        question_type: 'multiple_choice',
        selected_option: selectedOption,
      }
      continue
    }

    const responseText =
      typeof rawValue === 'string'
        ? rawValue
        : rawValue &&
            typeof rawValue === 'object' &&
            ((rawValue as { question_type?: unknown }).question_type === 'short_text' ||
              (rawValue as { question_type?: unknown }).question_type === 'link')
          ? (rawValue as { response_text?: unknown }).response_text
          : null

    if (typeof responseText !== 'string') {
      return { valid: false, error: 'All questions must be answered' }
    }

    const trimmed = responseText.trim()
    if (!trimmed) return { valid: false, error: 'All questions must be answered' }
    if (trimmed.length > maxChars) {
      return { valid: false, error: `Response is too long for question ${question.id}` }
    }

    if (question.question_type === 'link') {
      const normalizedUrl = normalizeSurveyUrl(trimmed)
      if (!normalizedUrl) return { valid: false, error: `Enter a valid link for question ${question.id}` }
      normalized[question.id] = {
        question_type: 'link',
        response_text: normalizedUrl,
      }
    } else {
      normalized[question.id] = {
        question_type: 'short_text',
        response_text: trimmed,
      }
    }
  }

  return { valid: true, responses: normalized }
}

export function aggregateSurveyResults(
  questions: SurveyQuestion[],
  responses: SurveyResponse[]
): SurveyQuestionResult[] {
  return questions.map((question) => {
    const questionResponses = responses.filter((response) => response.question_id === question.id)

    if (question.question_type === 'multiple_choice') {
      const counts = question.options.map((_, optionIndex) =>
        questionResponses.filter((response) => response.selected_option === optionIndex).length
      )
      return {
        question_id: question.id,
        question_type: question.question_type,
        question_text: question.question_text,
        options: question.options,
        counts,
        responses: [],
        total_responses: questionResponses.length,
      }
    }

    return {
      question_id: question.id,
      question_type: question.question_type,
      question_text: question.question_text,
      options: [],
      counts: [],
      responses: questionResponses
        .filter((response) => typeof response.response_text === 'string' && response.response_text.trim().length > 0)
        .map((response) => ({
          response_id: response.id,
          student_id: response.student_id,
          response_text: response.response_text || '',
          submitted_at: response.submitted_at,
          updated_at: response.updated_at,
        })),
      total_responses: questionResponses.length,
    }
  })
}

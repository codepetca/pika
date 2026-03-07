import { tryApplyJsonPatch } from '@/lib/json-patch'
import { validateQuizOptions } from '@/lib/quizzes'
import { validateTestQuestionCreate } from '@/lib/test-questions'
import type { JsonPatchOperation, TestQuestionType } from '@/types'

type SupabaseLike = any

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type AssessmentDraftType = 'quiz' | 'test'

export type QuizDraftQuestion = {
  id: string
  question_text: string
  options: string[]
}

export type TestDraftQuestion = {
  id: string
  question_type: TestQuestionType
  question_text: string
  options: string[]
  correct_option: number | null
  answer_key: string | null
  points: number
  response_max_chars: number
  response_monospace: boolean
}

export type QuizDraftContent = {
  title: string
  show_results: boolean
  questions: QuizDraftQuestion[]
}

export type TestDraftContent = {
  title: string
  show_results: boolean
  questions: TestDraftQuestion[]
}

export type AssessmentDraftRow<TContent> = {
  id: string
  assessment_type: AssessmentDraftType
  assessment_id: string
  classroom_id: string
  content: TContent
  version: number
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}

type ValidationResult<TContent> =
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

function ensureUniqueQuestionIds<TQuestion extends { id: string }>(questions: TQuestion[]): string | null {
  const ids = new Set<string>()
  for (const question of questions) {
    if (ids.has(question.id)) {
      return `Duplicate question id: ${question.id}`
    }
    ids.add(question.id)
  }
  return null
}

export function isMissingAssessmentDraftsError(error: {
  code?: string
  message?: string
  details?: string
  hint?: string
} | null | undefined): boolean {
  if (!error) return false
  const combined = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase()
  if (!combined.includes('assessment_drafts')) return false
  return error.code === 'PGRST205' || error.code === '42P01' || combined.includes('table')
}

export function validateQuizDraftContent(input: unknown): ValidationResult<QuizDraftContent> {
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

  const questions: QuizDraftQuestion[] = []

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

    const optionsValidation = validateQuizOptions(options)
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
    },
  }
}

export function validateTestDraftContent(
  input: unknown,
  options?: { allowEmptyQuestionText?: boolean }
): ValidationResult<TestDraftContent> {
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
    },
  }
}

export function buildNextDraftContent<TContent extends object>(
  currentContent: TContent,
  payload: { patch?: JsonPatchOperation[]; content?: unknown },
  validate: (input: unknown) => ValidationResult<TContent>
): { ok: true; content: TContent } | { ok: false; status: number; error: string } {
  let candidateContent: unknown

  if (Array.isArray(payload.patch)) {
    const patched = tryApplyJsonPatch(currentContent, payload.patch)
    if (!patched.success) {
      return { ok: false, status: 400, error: 'Invalid patch' }
    }
    candidateContent = patched.content
  } else {
    candidateContent = payload.content
  }

  const validation = validate(candidateContent)
  if (!validation.valid) {
    return { ok: false, status: 400, error: validation.error }
  }

  return { ok: true, content: validation.value }
}

export function buildQuizDraftContentFromRows(
  quiz: { title: string; show_results: boolean },
  questions: Array<{ id: string; question_text: string; options: unknown }>
): QuizDraftContent {
  return {
    title: quiz.title,
    show_results: quiz.show_results,
    questions: (questions || []).map((question) => {
      const options = parseStringArray(question.options) || []
      return {
        id: question.id,
        question_text: question.question_text,
        options,
      }
    }),
  }
}

export function buildTestDraftContentFromRows(
  test: { title: string; show_results: boolean },
  questions: Array<{
    id: string
    question_type: unknown
    question_text: string
    options: unknown
    correct_option: number | null
    answer_key: string | null
    points: number | string | null
    response_max_chars: number | string | null
    response_monospace: boolean | null
  }>
): TestDraftContent {
  return {
    title: test.title,
    show_results: test.show_results,
    questions: (questions || []).map((question) => ({
      id: question.id,
      question_type: question.question_type === 'open_response' ? 'open_response' : 'multiple_choice',
      question_text: question.question_text,
      options: parseStringArray(question.options) || [],
      correct_option:
        typeof question.correct_option === 'number' && Number.isInteger(question.correct_option)
          ? question.correct_option
          : null,
      answer_key:
        typeof question.answer_key === 'string' && question.answer_key.trim().length > 0
          ? question.answer_key.trim()
          : null,
      points: Number(question.points ?? 1),
      response_max_chars: Number(question.response_max_chars ?? 5000),
      response_monospace: question.response_monospace === true,
    })),
  }
}

export async function getAssessmentDraftByType<TContent>(
  supabase: SupabaseLike,
  assessmentType: AssessmentDraftType,
  assessmentId: string
): Promise<{ draft: AssessmentDraftRow<TContent> | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('assessment_drafts')
      .select('*')
      .eq('assessment_type', assessmentType)
      .eq('assessment_id', assessmentId)
      .maybeSingle()

    return { draft: (data as AssessmentDraftRow<TContent> | null) ?? null, error }
  } catch (error) {
    return {
      draft: null,
      error: {
        code: 'PGRST205',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

export async function createAssessmentDraft<TContent>(
  supabase: SupabaseLike,
  params: {
    assessmentType: AssessmentDraftType
    assessmentId: string
    classroomId: string
    userId: string
    content: TContent
  }
): Promise<{ draft: AssessmentDraftRow<TContent> | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('assessment_drafts')
      .insert({
        assessment_type: params.assessmentType,
        assessment_id: params.assessmentId,
        classroom_id: params.classroomId,
        content: params.content,
        version: 1,
        created_by: params.userId,
        updated_by: params.userId,
      })
      .select('*')
      .single()

    return { draft: (data as AssessmentDraftRow<TContent> | null) ?? null, error }
  } catch (error) {
    return {
      draft: null,
      error: {
        code: 'PGRST205',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

export async function updateAssessmentDraft<TContent>(
  supabase: SupabaseLike,
  draftId: string,
  version: number,
  userId: string,
  content: TContent
): Promise<{ draft: AssessmentDraftRow<TContent> | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('assessment_drafts')
      .update({
        content,
        version,
        updated_by: userId,
      })
      .eq('id', draftId)
      .select('*')
      .single()

    return { draft: (data as AssessmentDraftRow<TContent> | null) ?? null, error }
  } catch (error) {
    return {
      draft: null,
      error: {
        code: 'PGRST205',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

export async function syncQuizQuestionsFromDraft(
  supabase: SupabaseLike,
  quizId: string,
  content: QuizDraftContent
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data: existingRows, error: existingError } = await supabase
    .from('quiz_questions')
    .select('id')
    .eq('quiz_id', quizId)

  if (existingError) {
    return { ok: false, status: 500, error: 'Failed to load quiz questions for sync' }
  }

  const existingIds = new Set((existingRows || []).map((row: { id: string }) => row.id))
  const nextIds = new Set(content.questions.map((question) => question.id))

  for (const [position, question] of content.questions.entries()) {
    if (existingIds.has(question.id)) {
      const { error } = await supabase
        .from('quiz_questions')
        .update({
          question_text: question.question_text,
          options: question.options,
          position,
        })
        .eq('quiz_id', quizId)
        .eq('id', question.id)

      if (error) {
        return { ok: false, status: 500, error: 'Failed to update synced quiz question' }
      }
      continue
    }

    const { error } = await supabase
      .from('quiz_questions')
      .insert({
        id: question.id,
        quiz_id: quizId,
        question_text: question.question_text,
        options: question.options,
        position,
      })

    if (error) {
      return { ok: false, status: 500, error: 'Failed to insert synced quiz question' }
    }
  }

  for (const existingId of existingIds) {
    if (nextIds.has(existingId)) continue

    const { error } = await supabase
      .from('quiz_questions')
      .delete()
      .eq('quiz_id', quizId)
      .eq('id', existingId)

    if (error) {
      return { ok: false, status: 500, error: 'Failed to delete removed quiz question' }
    }
  }

  return { ok: true }
}

export async function syncTestQuestionsFromDraft(
  supabase: SupabaseLike,
  testId: string,
  content: TestDraftContent
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data: existingRows, error: existingError } = await supabase
    .from('test_questions')
    .select('id')
    .eq('test_id', testId)

  if (existingError) {
    return { ok: false, status: 500, error: 'Failed to load test questions for sync' }
  }

  const existingIds = new Set((existingRows || []).map((row: { id: string }) => row.id))
  const nextIds = new Set(content.questions.map((question) => question.id))

  for (const [position, question] of content.questions.entries()) {
    const rowPayload = {
      question_type: question.question_type,
      question_text: question.question_text,
      options: question.options,
      correct_option: question.correct_option,
      answer_key: question.answer_key,
      points: question.points,
      response_max_chars: question.response_max_chars,
      response_monospace: question.response_monospace,
      position,
    }

    if (existingIds.has(question.id)) {
      const { error } = await supabase
        .from('test_questions')
        .update(rowPayload)
        .eq('test_id', testId)
        .eq('id', question.id)

      if (error) {
        return { ok: false, status: 500, error: 'Failed to update synced test question' }
      }
      continue
    }

    const { error } = await supabase
      .from('test_questions')
      .insert({
        id: question.id,
        test_id: testId,
        ...rowPayload,
      })

    if (error) {
      return { ok: false, status: 500, error: 'Failed to insert synced test question' }
    }
  }

  for (const existingId of existingIds) {
    if (nextIds.has(existingId)) continue

    const { error } = await supabase
      .from('test_questions')
      .delete()
      .eq('test_id', testId)
      .eq('id', existingId)

    if (error) {
      return { ok: false, status: 500, error: 'Failed to delete removed test question' }
    }
  }

  return { ok: true }
}

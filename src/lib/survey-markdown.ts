import {
  DEFAULT_SURVEY_LINK_MAX_CHARS,
  DEFAULT_SURVEY_TEXT_MAX_CHARS,
  normalizeSurveyQuestionInput,
} from '@/lib/surveys'
import type { Survey, SurveyQuestion, SurveyQuestionType } from '@/types'

const FIELD_KEYS = new Set([
  'dynamic responses',
  'id',
  'max chars',
  'options',
  'prompt',
  'show results',
  'title',
  'type',
])

export interface SurveyMarkdownQuestion {
  id?: string
  question_type: SurveyQuestionType
  question_text: string
  options: string[]
  response_max_chars: number
}

export interface SurveyMarkdownContent {
  title: string
  show_results: boolean
  dynamic_responses: boolean
  questions: SurveyMarkdownQuestion[]
}

export interface SurveyMarkdownParseOptions {
  defaultShowResults?: boolean
  defaultDynamicResponses?: boolean
  existingQuestions?: Array<{ id: string }>
}

export interface SurveyMarkdownParseResult {
  content: SurveyMarkdownContent | null
  errors: string[]
}

export function surveyToMarkdown(input: {
  survey: Pick<Survey, 'title' | 'show_results' | 'dynamic_responses'>
  questions: Array<
    Pick<SurveyQuestion, 'id' | 'question_type' | 'question_text' | 'options' | 'response_max_chars'>
  >
}): string {
  const lines = [
    '# Survey',
    `Title: ${input.survey.title}`,
    `Show Results: ${input.survey.show_results ? 'true' : 'false'}`,
    `Dynamic Responses: ${input.survey.dynamic_responses ? 'true' : 'false'}`,
    '',
    '## Questions',
  ]

  input.questions.forEach((question, index) => {
    lines.push('', `### Question ${index + 1}`, `ID: ${question.id}`, `Type: ${question.question_type}`, 'Prompt:')
    lines.push(question.question_text || '')

    if (question.question_type === 'multiple_choice') {
      lines.push('', 'Options:')
      question.options.forEach((option) => lines.push(`- ${option}`))
    } else {
      lines.push('', `Max Chars: ${question.response_max_chars}`)
    }
  })

  return `${lines.join('\n').trimEnd()}\n`
}

function normalizeLineEndings(markdown: string): string[] {
  return markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

function parseBoolean(value: string): boolean | null {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true' || normalized === 'yes' || normalized === '1') return true
  if (normalized === 'false' || normalized === 'no' || normalized === '0') return false
  return null
}

function parseQuestionType(value: string): SurveyQuestionType | null {
  const normalized = value.trim().toLowerCase().replace(/[-\s]+/g, '_')
  if (normalized === 'mc' || normalized === 'multiple_choice') return 'multiple_choice'
  if (normalized === 'text' || normalized === 'short_text') return 'short_text'
  if (normalized === 'url' || normalized === 'link') return 'link'
  return null
}

function parseFieldLine(line: string): { key: string; value: string } | null {
  const match = line.match(/^([A-Za-z ]+):\s*(.*)$/)
  if (!match) return null
  return { key: match[1].trim().toLowerCase(), value: match[2] ?? '' }
}

function isKnownFieldLine(line: string): boolean {
  const parsed = parseFieldLine(line.trim())
  return parsed ? FIELD_KEYS.has(parsed.key) : false
}

function isHeading(line: string, level: 2 | 3): boolean {
  return line.trim().startsWith(level === 2 ? '## ' : '### ')
}

function parseMultilineField(
  lines: string[],
  startIndex: number,
  initialValue: string
): { value: string; nextIndex: number } {
  const collected: string[] = []
  if (initialValue.trim().length > 0) collected.push(initialValue)

  let index = startIndex + 1
  while (index < lines.length) {
    const nextLine = lines[index]
    if (isHeading(nextLine, 2) || isHeading(nextLine, 3) || isKnownFieldLine(nextLine)) break
    collected.push(nextLine)
    index += 1
  }

  return { value: collected.join('\n').trim(), nextIndex: index }
}

function parseOptionsField(
  lines: string[],
  startIndex: number,
  inlineValue: string
): { options: string[]; nextIndex: number } {
  const options: string[] = []
  if (inlineValue.trim().length > 0) options.push(inlineValue.trim())

  let index = startIndex + 1
  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line) {
      index += 1
      continue
    }
    if (line.startsWith('- ')) {
      const option = line.replace(/^- /, '').trim()
      if (option) options.push(option)
      index += 1
      continue
    }
    if (isHeading(lines[index], 2) || isHeading(lines[index], 3) || isKnownFieldLine(lines[index])) break
    break
  }

  return { options, nextIndex: index }
}

function splitQuestionBlocks(lines: string[]): Array<{ lines: string[] }> {
  const blocks: Array<{ lines: string[] }> = []
  let current: { lines: string[] } | null = null

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (isHeading(line, 3)) {
      if (current) blocks.push(current)
      current = { lines: [] }
      continue
    }
    if (!current) continue
    current.lines.push(line)
  }

  if (current) blocks.push(current)
  return blocks
}

function chooseId(candidate: string | undefined, fallback: string | undefined): string | undefined {
  const trimmedCandidate = candidate?.trim()
  if (trimmedCandidate) return trimmedCandidate
  const trimmedFallback = fallback?.trim()
  return trimmedFallback || undefined
}

function parseQuestionBlock(
  blockLines: string[],
  index: number,
  options: SurveyMarkdownParseOptions,
  errors: string[]
): SurveyMarkdownQuestion | null {
  let id: string | undefined
  let questionType: SurveyQuestionType = 'multiple_choice'
  let prompt = ''
  let choices: string[] = []
  let responseMaxChars: number | undefined
  let lineIndex = 0
  const label = `Question ${index + 1}`

  while (lineIndex < blockLines.length) {
    const line = blockLines[lineIndex]
    const trimmed = line.trim()
    if (!trimmed) {
      lineIndex += 1
      continue
    }

    const field = parseFieldLine(trimmed)
    if (!field) {
      errors.push(`${label}: Invalid line "${trimmed}"`)
      lineIndex += 1
      continue
    }

    if (field.key === 'id') {
      id = field.value.trim()
      lineIndex += 1
      continue
    }
    if (field.key === 'type') {
      const parsedType = parseQuestionType(field.value)
      if (!parsedType) errors.push(`${label}: Type must be multiple_choice, short_text, or link`)
      else questionType = parsedType
      lineIndex += 1
      continue
    }
    if (field.key === 'prompt') {
      const parsed = parseMultilineField(blockLines, lineIndex, field.value)
      prompt = parsed.value
      lineIndex = parsed.nextIndex
      continue
    }
    if (field.key === 'options') {
      const parsed = parseOptionsField(blockLines, lineIndex, field.value)
      choices = parsed.options
      lineIndex = parsed.nextIndex
      continue
    }
    if (field.key === 'max chars') {
      const parsedMaxChars = Number(field.value)
      if (!Number.isFinite(parsedMaxChars) || parsedMaxChars < 1) {
        errors.push(`${label}: Max Chars must be a positive number`)
      } else {
        responseMaxChars = parsedMaxChars
      }
      lineIndex += 1
      continue
    }

    errors.push(`${label}: Unknown field "${field.key}"`)
    lineIndex += 1
  }

  const normalized = normalizeSurveyQuestionInput({
    question_type: questionType,
    question_text: prompt,
    options: questionType === 'multiple_choice' ? choices : [],
    response_max_chars:
      responseMaxChars ??
      (questionType === 'link' ? DEFAULT_SURVEY_LINK_MAX_CHARS : DEFAULT_SURVEY_TEXT_MAX_CHARS),
  })

  if (!normalized.valid) {
    errors.push(`${label}: ${normalized.error}`)
    return null
  }

  const chosenId = chooseId(id, options.existingQuestions?.[index]?.id)
  return {
    ...(chosenId ? { id: chosenId } : {}),
    ...normalized.question,
  }
}

export function markdownToSurvey(
  markdown: string,
  options: SurveyMarkdownParseOptions = {}
): SurveyMarkdownParseResult {
  const lines = normalizeLineEndings(markdown)
  const errors: string[] = []
  let title = ''
  let showResults = options.defaultShowResults ?? false
  let dynamicResponses = options.defaultDynamicResponses ?? false
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (isHeading(line, 2)) break

    const field = parseFieldLine(line.trim())
    if (field?.key === 'title') {
      title = field.value.trim()
    } else if (field?.key === 'show results') {
      const parsed = parseBoolean(field.value)
      if (parsed === null) errors.push('Show Results must be true or false')
      else showResults = parsed
    } else if (field?.key === 'dynamic responses') {
      const parsed = parseBoolean(field.value)
      if (parsed === null) errors.push('Dynamic Responses must be true or false')
      else dynamicResponses = parsed
    }

    index += 1
  }

  if (!title) {
    const heading = lines.find((line) => line.trim().startsWith('# '))
    title = heading?.replace(/^#\s+/, '').trim() || ''
  }
  if (!title || title.toLowerCase() === 'survey') errors.push('Title is required')

  const questions = splitQuestionBlocks(lines)
    .map((block, questionIndex) => parseQuestionBlock(block.lines, questionIndex, options, errors))
    .filter((question): question is SurveyMarkdownQuestion => Boolean(question))

  const questionIds = questions.map((question) => question.id).filter((id): id is string => Boolean(id))
  if (new Set(questionIds).size !== questionIds.length) {
    errors.push('Question IDs must be unique')
  }
  if (questions.length === 0) errors.push('At least one question is required')

  if (errors.length > 0) return { content: null, errors }

  return {
    content: {
      title,
      show_results: showResults,
      dynamic_responses: dynamicResponses,
      questions,
    },
    errors: [],
  }
}

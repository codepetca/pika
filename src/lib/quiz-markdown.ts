import { validateQuizOptions } from '@/lib/quizzes'
import type { QuizDraftContent, QuizDraftQuestion } from '@/lib/server/assessment-drafts'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const FIELD_KEYS = new Set(['id', 'prompt', 'options', 'show results', 'title'])

export interface QuizMarkdownSerializeInput {
  title: string
  show_results: boolean
  questions: Array<{
    id: string
    question_text: string
    options: string[]
  }>
}

export interface QuizMarkdownParseOptions {
  defaultShowResults?: boolean
  existingQuestions?: Array<{ id: string }>
}

export interface QuizMarkdownParseResult {
  draftContent: QuizDraftContent | null
  errors: string[]
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

function generateUuid(): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16)
    const value = char === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

function chooseId(candidate: string | undefined, fallback: string | undefined): string {
  if (candidate && UUID_RE.test(candidate)) return candidate
  if (fallback && UUID_RE.test(fallback)) return fallback
  return generateUuid()
}

function splitQuestionBlocks(lines: string[]): Array<{ heading: string; lines: string[] }> {
  const blocks: Array<{ heading: string; lines: string[] }> = []
  let current: { heading: string; lines: string[] } | null = null

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (isHeading(line, 3)) {
      if (current) blocks.push(current)
      current = { heading: line.replace(/^###\s+/, '').trim(), lines: [] }
      continue
    }
    if (!current) continue
    current.lines.push(line)
  }

  if (current) blocks.push(current)
  return blocks
}

function parseQuestionBlock(
  blockLines: string[],
  index: number,
  options: QuizMarkdownParseOptions,
  errors: string[]
): QuizDraftQuestion | null {
  let id: string | undefined
  let prompt = ''
  let choices: string[] = []
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

    errors.push(`${label}: Unknown field "${field.key}"`)
    lineIndex += 1
  }

  if (!prompt.trim()) errors.push(`${label}: Prompt is required`)
  const optionsValidation = validateQuizOptions(choices)
  if (!optionsValidation.valid) {
    errors.push(`${label}: ${optionsValidation.error || 'Invalid options'}`)
  }
  if (!prompt.trim() || !optionsValidation.valid) return null

  return {
    id: chooseId(id, options.existingQuestions?.[index]?.id),
    question_text: prompt.trim(),
    options: choices.map((choice) => choice.trim()),
  }
}

export function quizToMarkdown(input: QuizMarkdownSerializeInput): string {
  const lines: string[] = [
    '# Quiz',
    `Title: ${input.title}`,
    `Show Results: ${input.show_results ? 'true' : 'false'}`,
    '',
    '## Questions',
  ]

  input.questions.forEach((question, index) => {
    lines.push('', `### Question ${index + 1}`, `ID: ${question.id}`, 'Prompt:')
    lines.push(question.question_text || '')
    lines.push('', 'Options:')
    question.options.forEach((option) => lines.push(`- ${option}`))
  })

  return `${lines.join('\n').trimEnd()}\n`
}

export function markdownToQuiz(
  markdown: string,
  options: QuizMarkdownParseOptions = {}
): QuizMarkdownParseResult {
  const lines = normalizeLineEndings(markdown)
  const errors: string[] = []
  let title = ''
  let showResults = options.defaultShowResults ?? false
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
    }

    index += 1
  }

  if (!title) {
    const heading = lines.find((line) => line.trim().startsWith('# '))
    title = heading?.replace(/^#\s+/, '').trim() || ''
  }
  if (!title || title.toLowerCase() === 'quiz') errors.push('Title is required')

  const questionBlocks = splitQuestionBlocks(lines)
  const questions = questionBlocks
    .map((block, questionIndex) => parseQuestionBlock(block.lines, questionIndex, options, errors))
    .filter((question): question is QuizDraftQuestion => Boolean(question))

  if (questions.length === 0) errors.push('At least one question is required')

  if (errors.length > 0) {
    return { draftContent: null, errors }
  }

  return {
    draftContent: {
      title,
      show_results: showResults,
      questions,
      source_format: 'markdown',
      source_markdown: markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
    },
    errors: [],
  }
}
